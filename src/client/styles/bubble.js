/**
 * src/client/styles/bubble.js — Option A 液态融合协同水泡、官方徽标与待命池样式
 *
 * 【核心职责】
 *   承载液态玻璃融合协同水泡（VisionOS Glass）、总控胶囊、双叶融合布局、主核与次级子代理卫星胶囊、
 *   右侧外协自由悬浮胶囊、官方品牌 Logo 圆标、内联派单条、待命池与「↻ 刷新扫描」按钮及浅色主题全套覆盖。
 *
 * 【边界约定】
 *   - 排在 `STYLE_SHEETS` 靠后位置，仅服务于「协同」页签中的水泡协作面板与待命池。
 */

export const CSS_BUBBLE = `
  /* Option A: Unified Liquid Fusion Bubble Canvas (VisionOS Glass Style) */
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
`
