/**
 * src/client/styles/bubble.js — 协同系统架构画布、工作态呼吸泛光与连线流光动效样式
 *
 * 【核心职责】
 *   承载统一协同画布（VisionOS Glass）、总控枢纽、主核与次级子代理卫星胶囊、
 *   右侧外协自由悬浮胶囊、官方品牌 Logo 圆标、内联派单条、待命池与「↻ 刷新扫描」按钮、
 *   停止静止 / 工作中微呼吸光效与流动连线动效、以及浅色主题全套覆盖。
 *
 * 【边界约定】
 *   - 排在 `STYLE_SHEETS` 靠后位置，仅服务于「协同」页签中的协同系统面板与待命池。
 */

export const CSS_BUBBLE = `
  /* Unified Collaboration System Canvas (VisionOS Glass Style) */
  .dnb-liquid-canvas {
    position: relative;
    padding: 10px 14px 14px;
    border-radius: 26px;
    corner-shape: round;
    overflow: hidden;
    background:
      linear-gradient(175deg, rgba(16, 28, 46, 0.90) 0%, rgba(12, 21, 36, 0.94) 100%);
    border: 1px solid rgba(125, 211, 252, 0.24);
    box-shadow:
      inset 0 1px 0 rgba(224, 242, 254, 0.16),
      0 8px 24px rgba(0, 0, 0, 0.20);
    display: flex;
    flex-direction: column;
    gap: 4px;
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .dnb-liquid-canvas[data-locked="1"] {
    border-color: rgba(245, 158, 11, 0.56);
    background:
      linear-gradient(175deg, rgba(26, 26, 40, 0.92) 0%, rgba(16, 20, 34, 0.95) 100%);
    box-shadow:
      inset 0 1px 0 rgba(254, 243, 199, 0.18),
      0 0 0 1px rgba(245, 158, 11, 0.14),
      0 8px 24px rgba(0, 0, 0, 0.24);
  }
  .dnb-liquid-canvas[data-dragover="1"] {
    border-style: dashed;
    border-color: #38bdf8;
    box-shadow:
      inset 0 0 0 1.5px rgba(56, 189, 248, 0.34),
      0 0 24px rgba(56, 189, 248, 0.20);
  }
  .dnb-liquid-canvas[data-shake="1"] {
    animation: dnb-bubble-shake 0.36s ease;
  }
  .dnb-liquid-core-frame {
    position: relative;
    width: 100%;
    max-width: 660px;
    margin: 0 auto;
    padding: 6px 8px 8px;
    display: flex;
    flex-direction: column;
    gap: 26px;
  }
  .dnb-panel.dnb-main .dnb-liquid-core-frame {
    max-width: 780px;
  }
  .dnb-liquid-membrane {
    position: relative;
    z-index: 2;
    padding: 18px 22px;
    border-radius: 28px;
    corner-shape: round;
    background:
      radial-gradient(240px 140px at 22% 45%, rgba(56, 189, 248, 0.14), transparent 72%),
      radial-gradient(240px 140px at 78% 45%, rgba(45, 212, 191, 0.10), transparent 72%),
      rgba(12, 23, 40, 0.58);
    border: 1px solid rgba(125, 211, 252, 0.24);
    box-shadow:
      inset 0 1px 0 rgba(224, 242, 254, 0.22),
      inset 0 -1px 0 rgba(125, 211, 252, 0.08),
      0 8px 24px rgba(0, 0, 0, 0.20);
    transition: border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease;
  }
  .dnb-liquid-membrane[data-dual="0"] {
    max-width: 440px;
    width: 100%;
    margin: 0 auto;
    background:
      radial-gradient(260px 140px at 50% 45%, rgba(56, 189, 248, 0.15), transparent 74%),
      rgba(12, 23, 40, 0.58);
  }
  .dnb-liquid-membrane[data-locked="1"] {
    background:
      radial-gradient(240px 140px at 22% 45%, rgba(245, 158, 11, 0.14), transparent 72%),
      radial-gradient(240px 140px at 78% 45%, rgba(217, 119, 6, 0.12), transparent 72%),
      rgba(22, 23, 36, 0.64);
    border-color: rgba(251, 191, 36, 0.44);
    box-shadow:
      inset 0 1px 0 rgba(254, 243, 199, 0.22),
      inset 0 -1px 0 rgba(245, 158, 11, 0.10),
      0 8px 24px rgba(0, 0, 0, 0.24);
  }
  .dnb-liquid-links-svg {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 3;
  }
  .dnb-squad-link-pill-bg {
    fill: rgba(13, 24, 42, 0.90);
    fill-opacity: 0.92;
  }
  .dnb-liquid-canvas[data-locked="1"] .dnb-squad-link-pill-bg {
    fill: rgba(24, 24, 38, 0.92);
  }
  .dnb-squad-link-pill-txt {
    font-size: 9px;
    font-weight: 700;
    font-family: "Microsoft YaHei UI", sans-serif;
  }

  .dnb-liquid-topbar {
    position: relative;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }

  /* Central Floating Coordinator Pill */
  .dnb-liquid-hub-wrap {
    position: relative;
    z-index: 4;
    display: flex;
    justify-content: center;
    margin-bottom: 0;
  }
  .dnb-liquid-hub {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 999px;
    corner-shape: round;
    backdrop-filter: blur(12px);
    -webkit-backdrop-filter: blur(12px);
    background: rgba(14, 26, 46, 0.94);
    border: 1px solid rgba(103, 232, 249, 0.50);
    box-shadow: 0 3px 12px rgba(14, 165, 233, 0.18);
  }
  .dnb-liquid-hub[data-locked="1"] {
    background: rgba(26, 25, 38, 0.95);
    border-color: rgba(251, 191, 36, 0.62);
    box-shadow: 0 3px 12px rgba(245, 158, 11, 0.20);
  }
  .dnb-liquid-hub-star {
    font-size: 12px;
    font-weight: 800;
    color: #38bdf8;
    line-height: 1;
  }
  .dnb-liquid-hub[data-locked="1"] .dnb-liquid-hub-star {
    color: #fbbf24;
  }
  .dnb-liquid-hub-name {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--dnb-text);
  }
  .dnb-liquid-hub-meta {
    font-size: 11px;
    color: var(--dnb-text-3);
  }
  .dnb-liquid-run-badge {
    font-size: 10px;
    font-weight: 700;
    padding: 1px 6px;
    border-radius: 999px;
    corner-shape: round;
    background: rgba(16, 185, 129, 0.18);
    color: #6ee7b7;
    border: 1px solid rgba(52, 211, 153, 0.40);
  }

  /* Two-Lobe Fusion Layout (Solo centers smoothly; Dual top-aligns Lead & Right Top Ally cleanly) */
  .dnb-liquid-body {
    position: relative;
    z-index: 4;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 36px;
    flex: 1;
    padding: 0;
  }
  .dnb-liquid-body[data-dual="1"] {
    align-items: flex-start;
    justify-content: space-between;
    gap: 44px;
    padding: 0;
  }
  @media (max-width: 520px) {
    .dnb-liquid-body[data-dual="1"] {
      flex-direction: column;
      align-items: center;
      gap: 24px;
    }
  }

  /* Left Primary Lead Core & Satellite Pearls */
  .dnb-liquid-lead-cluster {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    max-width: 100%;
  }
  .dnb-liquid-lead-cluster[data-dual="1"] {
    align-items: flex-start;
    max-width: 286px;
  }
  .dnb-liquid-lead-cluster[data-dual="1"] .dnb-liquid-satellites {
    justify-content: flex-start;
    padding-left: 6px;
  }
  .dnb-liquid-lead-orb {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 7px 12px 7px 11px;
    border-radius: 999px;
    corner-shape: round;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    background:
      radial-gradient(ellipse 80% 50% at 25% 0%, rgba(56, 189, 248, 0.24), transparent 72%),
      rgba(15, 29, 48, 0.84);
    border: 1.5px solid rgba(56, 189, 248, 0.62);
    box-shadow:
      inset 0 1px 0 rgba(224, 242, 254, 0.24),
      0 6px 18px rgba(14, 165, 233, 0.18);
  }
  .dnb-liquid-lead-orb[data-running="1"] {
    box-shadow:
      inset 0 1px 0 rgba(224, 242, 254, 0.24),
      0 0 0 2px rgba(52, 211, 153, 0.30),
      0 6px 18px rgba(14, 165, 233, 0.22);
  }
  .dnb-liquid-lead-name {
    font-size: 13px;
    font-weight: 700;
    color: var(--dnb-text);
    white-space: nowrap;
  }

  /* Close Satellite Pearls for Subagents (compact mini capsules nested visually under bigger lead orb) */
  .dnb-liquid-satellites {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    flex-wrap: wrap;
    max-width: 320px;
  }
  .dnb-liquid-satellites[data-compact="1"] {
    justify-content: flex-start;
    padding-left: 6px;
  }
  .dnb-liquid-sat-pill {
    display: inline-flex;
    align-items: center;
    gap: 3.5px;
    padding: 2px 5px 2px 6.5px;
    border-radius: 999px;
    corner-shape: round;
    backdrop-filter: blur(10px);
    background: rgba(15, 27, 45, 0.56);
    border: 1px solid rgba(148, 163, 184, 0.20);
    transition: border-color 0.16s ease, background 0.16s ease;
  }
  .dnb-liquid-sat-pill:hover {
    border-color: rgba(125, 211, 252, 0.46);
    background: rgba(20, 38, 62, 0.80);
  }
  .dnb-liquid-sat-pill[data-running="1"] {
    border-color: rgba(52, 211, 153, 0.48);
  }
  .dnb-liquid-sat-name {
    font-size: 10px;
    font-weight: 500;
    color: var(--dnb-text-2);
    white-space: nowrap;
  }
  .dnb-liquid-sat-pill:hover .dnb-liquid-sat-name {
    color: var(--dnb-text);
  }
  .dnb-sat-acts {
    display: inline-flex;
    align-items: center;
    gap: 1px;
  }
  .dnb-sat-btn {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    height: 15px;
    padding: 0 4px;
    border-radius: 999px;
    corner-shape: round;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-3);
    font: inherit;
    font-size: 9px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
  }
  .dnb-sat-btn:hover {
    background: rgba(56, 189, 248, 0.16);
    border-color: rgba(56, 189, 248, 0.36);
    color: var(--dnb-text);
  }

  /* Right Wing Glass Ally Pills (Floating freely without outer wrapper frame) */
  .dnb-liquid-ally-cluster {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 8px;
    min-width: 210px;
    max-width: 252px;
    flex-shrink: 0;
  }
  .dnb-liquid-peer-block {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .dnb-liquid-ally-pill {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px 6px 8px;
    border-radius: 999px;
    corner-shape: round;
    backdrop-filter: blur(14px);
    -webkit-backdrop-filter: blur(14px);
    background: rgba(15, 26, 44, 0.80);
    border: 1.2px solid rgba(148, 163, 184, 0.34);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.14),
      0 5px 16px rgba(0, 0, 0, 0.20);
    cursor: grab;
    min-width: 0;
  }
  .dnb-liquid-ally-pill:active {
    cursor: grabbing;
  }
  .dnb-liquid-ally-pill[data-tier="harness"] {
    border-style: dashed;
    border-color: rgba(217, 119, 87, 0.50);
  }
  .dnb-liquid-ally-pill[data-tier="harness"][data-provider="codex"] {
    border-color: rgba(56, 189, 248, 0.52);
  }
  .dnb-liquid-ally-pill[data-tier="peer"] {
    border-color: var(--pod-border, rgba(167, 139, 250, 0.52));
  }
  .dnb-liquid-ally-pill[data-running="1"] {
    border-style: solid;
    border-color: rgba(52, 211, 153, 0.62);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.18),
      0 0 0 2px rgba(52, 211, 153, 0.20),
      0 5px 16px rgba(0, 0, 0, 0.22);
  }
  .dnb-ally-info {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 1px;
  }
  .dnb-ally-name-row {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
  }
  .dnb-ally-name {
    font-size: 12px;
    font-weight: 700;
    color: var(--dnb-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dnb-ally-sub {
    font-size: 10px;
    color: var(--dnb-text-3);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dnb-ally-acts {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }

  .dnb-squad-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    corner-shape: round;
    flex-shrink: 0;
  }
  .dnb-tier-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    height: 17px;
    padding: 0 6px;
    border-radius: 999px;
    corner-shape: round;
    font-size: 9.5px;
    font-weight: 700;
    letter-spacing: 0.02em;
    flex-shrink: 0;
    line-height: 1;
  }
  .dnb-tier-badge[data-tier="primary"] {
    background: linear-gradient(135deg, #0284c7, #2563eb);
    color: #fff;
    border: 1px solid rgba(125, 211, 252, 0.55);
  }
  .dnb-tier-badge[data-tier="peer"] {
    height: 15px;
    padding: 0 5px;
    font-size: 9px;
    background: var(--pod-bg, rgba(167, 139, 250, 0.20));
    color: var(--pod-text, #c4b5fd);
    border: 1px solid var(--pod-border, rgba(167, 139, 250, 0.45));
  }
  .dnb-liquid-canvas .dnb-mini-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 2px;
    height: 20px;
    padding: 0 6px;
    border-radius: 999px;
    corner-shape: round;
    border: 1px solid rgba(255, 255, 255, 0.15);
    background: rgba(255, 255, 255, 0.06);
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 10px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.14s ease, border-color 0.14s ease, color 0.14s ease;
  }
  .dnb-liquid-canvas .dnb-mini-btn:hover {
    background: rgba(56, 189, 248, 0.18);
    border-color: rgba(56, 189, 248, 0.48);
    color: var(--dnb-text);
  }

  /* Official Brand Logo Circular Badges */
  .dnb-brand-badge {
    width: 30px;
    height: 30px;
    border-radius: 50%;
    corner-shape: round;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    background: rgba(255, 255, 255, 0.08);
    border: 1px solid rgba(255, 255, 255, 0.18);
    color: var(--dnb-text);
  }
  .dnb-brand-badge[data-provider="codex"] {
    background: rgba(56, 189, 248, 0.14);
    border-color: rgba(125, 211, 252, 0.36);
    color: #f8fafc;
  }
  .dnb-brand-badge[data-provider="claude-code"] {
    background: rgba(217, 119, 87, 0.16);
    border-color: rgba(217, 119, 87, 0.44);
  }

  /* Inline Dispatch Input Bar */
  .dnb-bubble-dispatch-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 7px 10px;
    border-radius: 16px;
    corner-shape: round;
    background: rgba(56, 189, 248, 0.08);
    border: 1px solid rgba(56, 189, 248, 0.34);
  }
  .dnb-bubble-dispatch-bar .dnb-brand-badge {
    width: 24px;
    height: 24px;
  }
  .dnb-dispatch-target-tag {
    font-size: 11px;
    font-weight: 700;
    color: #7dd3fc;
    white-space: nowrap;
  }

  /* Compact Shared Standby Pill Dock (replaces oversized card grid) */
  .dnb-liquid-dock {
    padding: 8px 11px;
    border-radius: 18px;
    corner-shape: round;
    background: rgba(255, 255, 255, 0.03);
    border: 1px dashed var(--dnb-border-strong);
    display: flex;
    flex-direction: column;
    gap: 6px;
    transition: border-color 0.18s ease, background 0.18s ease;
  }
  .dnb-liquid-dock[data-dragover="1"] {
    border-color: #f59e0b;
    background: rgba(245, 158, 11, 0.08);
  }
  .dnb-dock-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
  }
  .dnb-dock-title {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    font-size: 11px;
    font-weight: 700;
    color: var(--dnb-text-2);
  }
  .dnb-dock-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    corner-shape: round;
    background: #34d399;
    flex-shrink: 0;
  }
  .dnb-dock-hint {
    font-size: 10px;
    color: var(--dnb-text-3);
  }
  .dnb-dock-head-right {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
  }
  .dnb-dock-refresh-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    corner-shape: round;
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-card);
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
    transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
  }
  .dnb-dock-refresh-btn:hover:not(:disabled) {
    border-color: rgba(56, 189, 248, 0.56);
    background: var(--dnb-card-hover);
    color: var(--dnb-text);
  }
  .dnb-dock-refresh-btn:disabled {
    opacity: 0.65;
    cursor: progress;
  }
  html[data-ds-theme-source="light"] .dnb-dock-refresh-btn,
  html[data-ds-theme="light"] .dnb-dock-refresh-btn {
    background: #ffffff;
    border-color: #cbd5e1;
    color: #334155;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
  }
  html[data-ds-theme-source="light"] .dnb-dock-refresh-btn:hover:not(:disabled),
  html[data-ds-theme="light"] .dnb-dock-refresh-btn:hover:not(:disabled) {
    background: #eff6ff;
    border-color: rgba(2, 132, 199, 0.45);
    color: #0369a1;
  }
  .dnb-dock-flow {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
  }
  .dnb-dock-pill {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    height: 28px;
    padding: 0 9px 0 6px;
    border-radius: 999px;
    corner-shape: round;
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
    cursor: pointer;
    user-select: none;
    max-width: 100%;
    transition: border-color 0.15s ease, background 0.15s ease, transform 0.12s ease;
  }
  .dnb-dock-pill:hover {
    border-color: rgba(56, 189, 248, 0.56);
    background: var(--dnb-card-hover);
  }
  .dnb-dock-pill:active {
    cursor: grabbing;
    transform: scale(0.98);
  }
  .dnb-dock-pill[data-kind="standby-session"] {
    padding-left: 9px;
  }
  .dnb-dock-pill .dnb-brand-badge {
    width: 20px;
    height: 20px;
  }
  .dnb-dock-pill-name {
    font-size: 11px;
    font-weight: 600;
    color: var(--dnb-text);
    max-width: 152px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dnb-dock-bolt-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 18px;
    height: 18px;
    padding: 0;
    border-radius: 50%;
    corner-shape: round;
    border: 1px solid rgba(56, 189, 248, 0.36);
    background: rgba(56, 189, 248, 0.14);
    color: #7dd3fc;
    font-size: 10px;
    line-height: 1;
    cursor: pointer;
    flex-shrink: 0;
  }
  .dnb-dock-bolt-btn[data-active="1"],
  .dnb-dock-bolt-btn:hover {
    background: var(--dnb-primary-bg, #2563eb);
    color: #fff;
    border-color: transparent;
  }
  .dnb-dock-plus {
    font-size: 11.5px;
    font-weight: 700;
    color: var(--dnb-accent, #38bdf8);
    line-height: 1;
    flex-shrink: 0;
  }
  .dnb-dock-empty {
    font-size: 11px;
    color: var(--dnb-text-3);
    line-height: 1.4;
  }

  /* Light Theme Overrides for Option A Liquid Fusion Bubble */
  html[data-ds-theme-source="light"] .dnb-bubble-status,
  html[data-ds-theme="light"] .dnb-bubble-status,
  [data-ds-theme-source="light"] .dnb-bubble-status {
    color: #047857;
    background: rgba(16, 185, 129, 0.12);
    border-color: rgba(5, 150, 105, 0.34);
  }
  html[data-ds-theme-source="light"] .dnb-bubble-status[data-locked="1"],
  html[data-ds-theme="light"] .dnb-bubble-status[data-locked="1"],
  [data-ds-theme-source="light"] .dnb-bubble-status[data-locked="1"] {
    color: #b45309;
    background: rgba(245, 158, 11, 0.14);
    border-color: rgba(217, 119, 6, 0.42);
  }
  html[data-ds-theme-source="light"] .dnb-bubble-estop-btn,
  html[data-ds-theme="light"] .dnb-bubble-estop-btn,
  [data-ds-theme-source="light"] .dnb-bubble-estop-btn {
    color: #b91c1c !important;
    background: rgba(239, 68, 68, 0.10) !important;
  }
  html[data-ds-theme-source="light"] .dnb-liquid-canvas,
  html[data-ds-theme="light"] .dnb-liquid-canvas,
  [data-ds-theme-source="light"] .dnb-liquid-canvas {
    background: linear-gradient(175deg, #f0f9ff 0%, #eaf5fd 100%);
    border-color: rgba(2, 132, 199, 0.30);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.92),
      0 6px 18px rgba(15, 23, 42, 0.06);
  }
  html[data-ds-theme-source="light"] .dnb-liquid-canvas[data-locked="1"],
  html[data-ds-theme="light"] .dnb-liquid-canvas[data-locked="1"],
  [data-ds-theme-source="light"] .dnb-liquid-canvas[data-locked="1"] {
    background: linear-gradient(175deg, #fffbeb 0%, #fef7dc 100%);
    border-color: rgba(217, 119, 6, 0.52);
  }
  html[data-ds-theme-source="light"] .dnb-liquid-membrane,
  html[data-ds-theme="light"] .dnb-liquid-membrane,
  [data-ds-theme-source="light"] .dnb-liquid-membrane {
    background:
      radial-gradient(240px 140px at 22% 45%, rgba(14, 165, 233, 0.10), transparent 72%),
      radial-gradient(240px 140px at 78% 45%, rgba(20, 184, 166, 0.08), transparent 72%),
      rgba(255, 255, 255, 0.72);
    border-color: rgba(2, 132, 199, 0.22);
    box-shadow:
      inset 0 1px 0 rgba(255, 255, 255, 0.96),
      0 6px 18px rgba(15, 23, 42, 0.05);
  }
  html[data-ds-theme-source="light"] .dnb-liquid-membrane[data-locked="1"],
  html[data-ds-theme="light"] .dnb-liquid-membrane[data-locked="1"],
  [data-ds-theme-source="light"] .dnb-liquid-membrane[data-locked="1"] {
    background:
      radial-gradient(240px 140px at 22% 45%, rgba(245, 158, 11, 0.12), transparent 72%),
      rgba(255, 251, 235, 0.80);
    border-color: rgba(217, 119, 6, 0.44);
  }
  html[data-ds-theme-source="light"] .dnb-squad-link-pill-bg,
  html[data-ds-theme="light"] .dnb-squad-link-pill-bg,
  [data-ds-theme-source="light"] .dnb-squad-link-pill-bg {
    fill: rgba(248, 252, 255, 0.96);
    fill-opacity: 0.96;
  }
  html[data-ds-theme-source="light"] .dnb-liquid-hub,
  html[data-ds-theme="light"] .dnb-liquid-hub,
  [data-ds-theme-source="light"] .dnb-liquid-hub {
    background: rgba(255, 255, 255, 0.88);
    border-color: rgba(2, 132, 199, 0.42);
    box-shadow: 0 3px 10px rgba(15, 23, 42, 0.06);
  }
  html[data-ds-theme-source="light"] .dnb-liquid-hub-star,
  html[data-ds-theme="light"] .dnb-liquid-hub-star,
  [data-ds-theme-source="light"] .dnb-liquid-hub-star {
    color: #0284c7;
  }
  html[data-ds-theme-source="light"] .dnb-liquid-run-badge,
  html[data-ds-theme="light"] .dnb-liquid-run-badge,
  [data-ds-theme-source="light"] .dnb-liquid-run-badge {
    color: #047857;
    background: rgba(16, 185, 129, 0.14);
  }
  html[data-ds-theme-source="light"] .dnb-liquid-lead-orb,
  html[data-ds-theme="light"] .dnb-liquid-lead-orb,
  [data-ds-theme-source="light"] .dnb-liquid-lead-orb {
    background: linear-gradient(180deg, rgba(224, 242, 254, 0.86), rgba(255, 255, 255, 0.96));
    border-color: rgba(2, 132, 199, 0.56);
    box-shadow: 0 4px 14px rgba(2, 132, 199, 0.12);
  }
  html[data-ds-theme-source="light"] .dnb-liquid-sat-pill,
  html[data-ds-theme="light"] .dnb-liquid-sat-pill,
  [data-ds-theme-source="light"] .dnb-liquid-sat-pill {
    background: rgba(255, 255, 255, 0.90);
    border-color: rgba(15, 23, 42, 0.14);
  }
  html[data-ds-theme-source="light"] .dnb-sat-btn,
  html[data-ds-theme="light"] .dnb-sat-btn,
  [data-ds-theme-source="light"] .dnb-sat-btn {
    background: transparent;
    border-color: transparent;
  }
  html[data-ds-theme-source="light"] .dnb-sat-btn:hover,
  html[data-ds-theme="light"] .dnb-sat-btn:hover,
  [data-ds-theme-source="light"] .dnb-sat-btn:hover {
    background: rgba(2, 132, 199, 0.10);
    border-color: rgba(2, 132, 199, 0.28);
  }
  html[data-ds-theme-source="light"] .dnb-liquid-canvas .dnb-mini-btn,
  html[data-ds-theme="light"] .dnb-liquid-canvas .dnb-mini-btn {
    background: rgba(255, 255, 255, 0.88);
    border-color: rgba(15, 23, 42, 0.18);
    color: #334155;
  }
  html[data-ds-theme-source="light"] .dnb-liquid-canvas .dnb-mini-btn:hover,
  html[data-ds-theme="light"] .dnb-liquid-canvas .dnb-mini-btn:hover {
    background: #e0f2fe;
    border-color: rgba(2, 132, 199, 0.42);
    color: #0369a1;
  }
  html[data-ds-theme-source="light"] .dnb-dock-pill,
  html[data-ds-theme="light"] .dnb-dock-pill {
    background: #ffffff;
    border-color: #cbd5e1;
    box-shadow: 0 1px 2px rgba(15, 23, 42, 0.05);
  }
  html[data-ds-theme-source="light"] .dnb-dock-pill:hover,
  html[data-ds-theme="light"] .dnb-dock-pill:hover {
    border-color: rgba(2, 132, 199, 0.45);
    background: #f8fafc;
  }
  html[data-ds-theme-source="light"] .dnb-liquid-ally-pill,
  html[data-ds-theme="light"] .dnb-liquid-ally-pill,
  [data-ds-theme-source="light"] .dnb-liquid-ally-pill {
    background: rgba(255, 255, 255, 0.90);
    box-shadow: 0 4px 12px rgba(15, 23, 42, 0.07);
  }
  html[data-ds-theme-source="light"] .dnb-brand-badge[data-provider="codex"],
  html[data-ds-theme="light"] .dnb-brand-badge[data-provider="codex"],
  [data-ds-theme-source="light"] .dnb-brand-badge[data-provider="codex"] {
    background: rgba(15, 23, 42, 0.06);
    border-color: rgba(15, 23, 42, 0.18);
    color: #0f172a;
  }
  html[data-ds-theme-source="light"] .dnb-dispatch-target-tag,
  html[data-ds-theme="light"] .dnb-dispatch-target-tag,
  [data-ds-theme-source="light"] .dnb-dispatch-target-tag {
    color: #0369a1;
  }
  html[data-ds-theme-source="light"] .dnb-liquid-dock,
  html[data-ds-theme="light"] .dnb-liquid-dock,
  [data-ds-theme-source="light"] .dnb-liquid-dock {
    background: rgba(15, 23, 42, 0.02);
  }
  html[data-ds-theme-source="light"] .dnb-dock-bolt-btn,
  html[data-ds-theme="light"] .dnb-dock-bolt-btn,
  [data-ds-theme-source="light"] .dnb-dock-bolt-btn {
    color: #0284c7;
    background: rgba(2, 132, 199, 0.10);
    border-color: rgba(2, 132, 199, 0.28);
  }

  /* Redesigned Grouped Card-Stream Team Mailbox */
  .dnb-mail-threads {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dnb-mail-thread {
    border-radius: 11px;
    border: 1px solid var(--dnb-border);
    background: rgba(15, 23, 42, 0.16);
    overflow: hidden;
    transition: border-color 0.15s ease;
  }
  .dnb-mail-thread:hover {
    border-color: var(--dnb-border-strong);
  }
  .dnb-mail-thread[data-kind="detached"] {
    opacity: 0.72;
  }
  .dnb-mail-thread[data-single="1"] {
    border: none;
    border-radius: 0;
    background: transparent;
  }
  .dnb-mail-thread-head {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 12px;
    cursor: pointer;
    user-select: none;
    background: transparent;
    transition: background 0.14s ease;
  }
  .dnb-mail-thread[data-open="1"] > .dnb-mail-thread-head {
    background: var(--dnb-thread-tint, rgba(99, 102, 241, 0.08));
    border-bottom: 1px solid var(--dnb-border);
  }
  .dnb-mail-thread-head:hover {
    background: var(--dnb-card-hover);
  }
  .dnb-mail-thread-bar {
    position: absolute;
    left: 0;
    top: 0;
    bottom: 0;
    width: 3px;
  }
  .dnb-mail-thread-meta {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }
  .dnb-mail-channel-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    background: rgba(148, 163, 184, 0.10);
    color: var(--dnb-text-2);
    flex-shrink: 0;
  }
  .dnb-mail-channel-pill[data-kind="broadcast"] {
    color: #38bdf8;
    background: rgba(56, 189, 248, 0.12);
    border-color: rgba(56, 189, 248, 0.30);
  }
  .dnb-mail-channel-pill[data-kind="cross"] {
    color: #c084fc;
    background: rgba(168, 85, 247, 0.12);
    border-color: rgba(168, 85, 247, 0.30);
  }
  .dnb-mail-channel-pill[data-kind="internal"] {
    color: #93c5fd;
    background: rgba(59, 130, 246, 0.12);
    border-color: rgba(59, 130, 246, 0.28);
  }
  .dnb-mail-thread-title {
    font-size: 12px;
    font-weight: 600;
    color: var(--dnb-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dnb-mail-feed {
    padding: 10px 12px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .dnb-mail-msg {
    position: relative;
    padding: 0;
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    background: rgba(255, 255, 255, 0.025);
    overflow: hidden;
    transition: border-color 0.14s ease, background 0.14s ease;
  }
  .dnb-mail-msg:hover {
    border-color: var(--dnb-border-strong);
  }
  .dnb-mail-msg[data-expanded="1"] {
    background: var(--dnb-card);
    border-color: var(--dnb-border-strong);
  }
  .dnb-mail-row-btn {
    width: 100%;
    border: none;
    background: transparent;
    padding: 9px 11px;
    text-align: left;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    gap: 4px;
    font: inherit;
    color: inherit;
  }
  .dnb-mail-row-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    min-width: 0;
  }
  .dnb-mail-row-left {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    flex: 1;
  }
  .dnb-mail-chevron {
    font-size: 11px;
    line-height: 1;
    color: var(--dnb-text-3);
    flex-shrink: 0;
    width: 10px;
    text-align: center;
  }
  .dnb-mail-row-right {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    flex-shrink: 0;
    font-size: 11px;
    color: var(--dnb-text-3);
  }
  .dnb-mail-dot {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    flex-shrink: 0;
    background: var(--dnb-text-3);
  }
  .dnb-mail-dot[data-role="chief"] { background: var(--dnb-accent, #6366f1); }
  .dnb-mail-dot[data-role="lead"] { background: #10b981; }
  .dnb-mail-dot[data-role="harness"] { background: #f59e0b; }
  .dnb-mail-dot[data-role="subagent"] { background: var(--dnb-accent, #6366f1); opacity: 0.72; }
  .dnb-mail-route-quiet {
    max-width: 150px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--dnb-text-3);
    font-size: 11px;
  }
  .dnb-mail-mode {
    border: none;
    background: transparent;
    padding: 0;
    font-size: 11px;
    font-weight: 500;
    color: var(--dnb-text-3);
  }
  .dnb-mail-mode[data-mode="steer"] { color: #fbbf24; }
  .dnb-mail-mode[data-mode="followup"] { color: #60a5fa; }
  .dnb-mail-time {
    font-size: 10.5px;
    color: var(--dnb-text-3);
    white-space: nowrap;
  }
  .dnb-mail-subject {
    font-size: 12.4px;
    font-weight: 560;
    color: var(--dnb-text);
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .dnb-mail-preview {
    padding-left: 16px;
    font-size: 11.6px;
    color: var(--dnb-text-3);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.45;
  }
  .dnb-mail-detail {
    padding: 9px 12px 10px 27px;
    border-top: 1px solid var(--dnb-border);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dnb-mail-body {
    font-size: 12px;
    color: var(--dnb-text-2);
    line-height: 1.64;
    max-width: 72ch;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .dnb-mail-detail-foot {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    padding-top: 6px;
    border-top: 1px dashed var(--dnb-border);
    font-size: 11px;
    color: var(--dnb-text-3);
  }
  .dnb-mail-foot-btn {
    border: none;
    background: transparent;
    padding: 0;
    font: inherit;
    font-size: 11px;
    color: var(--dnb-text-3);
    cursor: pointer;
    transition: color 0.14s ease;
  }
  .dnb-mail-foot-btn:hover {
    color: var(--dnb-text);
  }
  html[data-ds-theme-source="light"] .dnb-mail-thread {
    background: #f8fafc;
    border-color: rgba(15, 23, 42, 0.10);
  }
  html[data-ds-theme-source="light"] .dnb-mail-thread[data-single="1"] {
    background: transparent;
    border: none;
  }
  html[data-ds-theme-source="light"] .dnb-mail-thread[data-open="1"] > .dnb-mail-thread-head {
    background: linear-gradient(90deg, rgba(79, 70, 229, 0.07), #f8fafc 60%);
    border-bottom-color: rgba(15, 23, 42, 0.08);
  }
  html[data-ds-theme-source="light"] .dnb-mail-channel-pill[data-kind="broadcast"] {
    color: #0284c7;
    background: #e0f2fe;
    border-color: rgba(2, 132, 199, 0.26);
  }
  html[data-ds-theme-source="light"] .dnb-mail-channel-pill[data-kind="cross"] {
    color: #7e22ce;
    background: #f3e8ff;
    border-color: rgba(126, 34, 206, 0.24);
  }
  html[data-ds-theme-source="light"] .dnb-mail-channel-pill[data-kind="internal"] {
    color: #1d4ed8;
    background: #eff6ff;
    border-color: rgba(37, 99, 235, 0.24);
  }
  html[data-ds-theme-source="light"] .dnb-mail-msg {
    background: #f8fafc;
    border-color: rgba(15, 23, 42, 0.10);
  }
  html[data-ds-theme-source="light"] .dnb-mail-msg:hover {
    border-color: rgba(15, 23, 42, 0.18);
  }
  html[data-ds-theme-source="light"] .dnb-mail-msg[data-expanded="1"] {
    background: #ffffff;
    border-color: rgba(15, 23, 42, 0.18);
  }
  html[data-ds-theme-source="light"] .dnb-mail-mode[data-mode="steer"] {
    color: #b45309;
    background: transparent;
  }
  html[data-ds-theme-source="light"] .dnb-mail-mode[data-mode="followup"] {
    color: #1d4ed8;
    background: transparent;
  }
  html[data-ds-theme-source="light"] .dnb-mail-body {
    color: #334155;
  }

  /* Idle = static; Active working = gentle theme-colored breathing glow & flowing links */
  @keyframes dnb-icon-breathe {
    0%, 100% {
      filter: drop-shadow(0 0 2px var(--dnb-glow-soft, rgba(56, 189, 248, 0.20)));
      box-shadow: var(--dnb-glow-ring-min, 0 0 0 0 rgba(56, 189, 248, 0.10));
    }
    50% {
      filter: drop-shadow(0 0 6px var(--dnb-glow-strong, rgba(56, 189, 248, 0.56)));
      box-shadow: var(--dnb-glow-ring-max, 0 0 12px 1px rgba(56, 189, 248, 0.28));
    }
  }
  @keyframes dnb-link-dash-flow {
    from { stroke-dashoffset: 24; }
    to { stroke-dashoffset: 0; }
  }

  .dnb-bubble-status[data-working="0"] .dnb-bubble-status-dot,
  .dnb-liquid-hub[data-working="0"],
  .dnb-liquid-hub[data-working="0"] .dnb-liquid-hub-star,
  .dnb-liquid-lead-orb[data-running="0"],
  .dnb-liquid-lead-orb[data-running="0"] .dnb-tier-badge[data-tier="primary"],
  .dnb-liquid-sat-pill[data-running="0"],
  .dnb-liquid-ally-pill[data-running="0"] .dnb-brand-badge,
  .dnb-liquid-ally-pill[data-running="0"] .dnb-squad-dot {
    animation: none;
  }

  .dnb-bubble-status[data-working="1"] .dnb-bubble-status-dot {
    --dnb-glow-soft: rgba(52, 211, 153, 0.26);
    --dnb-glow-strong: rgba(52, 211, 153, 0.72);
    --dnb-glow-ring-min: 0 0 0 0 rgba(52, 211, 153, 0.14);
    --dnb-glow-ring-max: 0 0 8px 2px rgba(52, 211, 153, 0.36);
    animation: dnb-icon-breathe 2.4s ease-in-out infinite;
  }
  .dnb-liquid-hub[data-working="1"] {
    --dnb-glow-soft: rgba(56, 189, 248, 0.12);
    --dnb-glow-strong: rgba(56, 189, 248, 0.34);
    --dnb-glow-ring-min: 0 3px 10px rgba(14, 165, 233, 0.14);
    --dnb-glow-ring-max: 0 0 14px rgba(56, 189, 248, 0.28);
    animation: dnb-icon-breathe 2.6s ease-in-out infinite;
  }
  .dnb-liquid-hub[data-working="1"] .dnb-liquid-hub-star {
    --dnb-glow-soft: rgba(56, 189, 248, 0.24);
    --dnb-glow-strong: rgba(56, 189, 248, 0.72);
    --dnb-glow-ring-min: none;
    --dnb-glow-ring-max: none;
    animation: dnb-icon-breathe 2.2s ease-in-out infinite;
  }
  .dnb-liquid-lead-orb[data-running="1"] .dnb-tier-badge[data-tier="primary"] {
    --dnb-glow-soft: rgba(56, 189, 248, 0.22);
    --dnb-glow-strong: rgba(56, 189, 248, 0.65);
    --dnb-glow-ring-min: 0 0 0 0 rgba(56, 189, 248, 0.10);
    --dnb-glow-ring-max: 0 0 10px 1px rgba(56, 189, 248, 0.34);
    animation: dnb-icon-breathe 2.3s ease-in-out infinite;
  }
  .dnb-liquid-sat-pill[data-running="1"] {
    --dnb-glow-soft: rgba(56, 189, 248, 0.16);
    --dnb-glow-strong: rgba(56, 189, 248, 0.42);
    --dnb-glow-ring-min: 0 0 0 0 rgba(56, 189, 248, 0.08);
    --dnb-glow-ring-max: 0 0 8px 0 rgba(56, 189, 248, 0.24);
    animation: dnb-icon-breathe 2.4s ease-in-out infinite;
  }
  .dnb-liquid-ally-pill[data-running="1"][data-tier="harness"] .dnb-brand-badge {
    --dnb-glow-soft: rgba(56, 189, 248, 0.24);
    --dnb-glow-strong: rgba(56, 189, 248, 0.64);
    --dnb-glow-ring-min: 0 0 0 0 rgba(56, 189, 248, 0.14);
    --dnb-glow-ring-max: 0 0 12px 1px rgba(56, 189, 248, 0.34);
    animation: dnb-icon-breathe 2.3s ease-in-out infinite;
  }
  .dnb-liquid-ally-pill[data-running="1"][data-provider="claude-code"] .dnb-brand-badge {
    --dnb-glow-soft: rgba(217, 119, 87, 0.26);
    --dnb-glow-strong: rgba(217, 119, 87, 0.72);
    --dnb-glow-ring-min: 0 0 0 0 rgba(217, 119, 87, 0.14);
    --dnb-glow-ring-max: 0 0 12px 1px rgba(217, 119, 87, 0.38);
  }
  .dnb-liquid-ally-pill[data-running="1"][data-tier="peer"] .dnb-squad-dot {
    --dnb-glow-soft: rgba(167, 139, 250, 0.24);
    --dnb-glow-strong: rgba(167, 139, 250, 0.70);
    --dnb-glow-ring-min: 0 0 0 0 rgba(167, 139, 250, 0.14);
    --dnb-glow-ring-max: 0 0 10px 1px rgba(167, 139, 250, 0.36);
    animation: dnb-icon-breathe 2.3s ease-in-out infinite;
  }

  .dnb-squad-link-path-active {
    animation: dnb-link-dash-flow 1.4s linear infinite;
  }
  .dnb-squad-link-path-active[data-kind="collab-sync"] {
    animation-duration: 1.9s;
  }
  .dnb-squad-link-glow {
    pointer-events: none;
  }
  .dnb-squad-link-pulse {
    filter: drop-shadow(0 0 3px currentColor);
  }

  html[data-ds-theme-source="light"] .dnb-liquid-hub[data-working="1"] {
    --dnb-glow-ring-min: 0 3px 10px rgba(2, 132, 199, 0.10);
    --dnb-glow-ring-max: 0 0 12px rgba(2, 132, 199, 0.22);
  }
  html[data-ds-theme-source="light"] .dnb-liquid-ally-pill[data-running="1"][data-tier="harness"][data-provider="codex"] .dnb-brand-badge {
    --dnb-glow-soft: rgba(2, 132, 199, 0.18);
    --dnb-glow-strong: rgba(2, 132, 199, 0.44);
    --dnb-glow-ring-max: 0 0 10px 1px rgba(2, 132, 199, 0.24);
  }
  html[data-ds-theme-source="light"] .dnb-liquid-ally-pill[data-running="1"][data-provider="claude-code"] .dnb-brand-badge {
    --dnb-glow-soft: rgba(217, 119, 87, 0.20);
    --dnb-glow-strong: rgba(217, 119, 87, 0.48);
    --dnb-glow-ring-max: 0 0 10px 1px rgba(217, 119, 87, 0.26);
  }

  @media (prefers-reduced-motion: reduce) {
    .dnb-bubble-status[data-working="1"] .dnb-bubble-status-dot,
    .dnb-liquid-hub[data-working="1"],
    .dnb-liquid-hub[data-working="1"] .dnb-liquid-hub-star,
    .dnb-liquid-lead-orb[data-running="1"] .dnb-tier-badge[data-tier="primary"],
    .dnb-liquid-sat-pill[data-running="1"],
    .dnb-liquid-ally-pill[data-running="1"] .dnb-brand-badge,
    .dnb-liquid-ally-pill[data-running="1"] .dnb-squad-dot,
    .dnb-squad-link-path-active {
      animation: none !important;
    }
  }
`
