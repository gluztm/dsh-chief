/**
 * styles.js
 *
 * Complete DSH Chief client stylesheet and <Style /> injector.
 */

import { h } from './react-runtime.js'

const CSS = `
  .dnb-panel {
    --dnb-card: var(--dsw-alias-card-fill, var(--dsw-alias-bg-layer-1, rgba(128,128,136,0.08)));
    --dnb-card-hover: var(--dsw-alias-card-fill-hover, var(--dsw-alias-bg-layer-2, rgba(128,128,136,0.13)));
    --dnb-fill: var(--dsw-alias-fill-l1, var(--dsw-alias-bg-layer-2, rgba(120,120,128,0.16)));
    --dnb-elevated: var(--dsw-alias-bg-elevated, var(--dsw-alias-bg-layer-3, #262629));
    --dnb-popover: var(--dsw-alias-hovercard-bg, var(--dsw-alias-bg-elevated, #252528));
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

  .dnb-dock {
    height: 100%;
    flex: 1 1 auto;
    min-height: 0;
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

  /* iOS Segmented Control */
  .dnb-seg-wrap {
    padding: 0 12px 8px;
    flex-shrink: 0;
  }
  .dnb-seg {
    display: flex;
    padding: 2.5px;
    border-radius: 10px;
    background: var(--dnb-fill);
    gap: 2px;
  }
  .dnb-seg-btn {
    flex: 1 1 0;
    min-width: 0;
    border: none;
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
    transition: background 0.2s cubic-bezier(0.32, 0.72, 0, 1), color 0.2s ease, box-shadow 0.2s ease, transform 0.12s ease;
  }
  .dnb-seg-btn:hover { color: var(--dnb-text); }
  .dnb-seg-btn:active { transform: scale(0.96); }
  .dnb-seg-btn[data-active="1"] {
    background: var(--dnb-elevated);
    color: var(--dnb-text);
    font-weight: 600;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.18), 0 0 0 0.5px var(--dnb-border);
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
    height: 28px;
    padding: 0 12px;
    border-radius: 99px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 12px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    white-space: nowrap;
    transition: all 0.16s cubic-bezier(0.32, 0.72, 0, 1);
  }
  .dnb-pill:hover {
    background: var(--dnb-card-hover);
    color: var(--dnb-text);
    border-color: var(--dnb-border-strong);
  }
  .dnb-pill:active { transform: scale(0.95); }
  .dnb-pill[data-active="1"] {
    background: rgba(10, 132, 255, 0.14);
    border-color: rgba(10, 132, 255, 0.45);
    color: var(--dnb-accent);
  }
  .dnb-pill-accent {
    background: rgba(10, 132, 255, 0.12);
    border-color: rgba(10, 132, 255, 0.3);
    color: var(--dnb-accent);
  }
  .dnb-pill-danger {
    color: #ff453a;
    border-color: rgba(255, 69, 58, 0.25);
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
    height: 4px;
    border-radius: 99px;
    background: var(--dnb-fill);
    overflow: hidden;
    display: flex;
  }

  /* Grand Full-Width Zero-Drag Pyramid Tree (大气铺开金字塔树) */
  .dnb-pyr-root {
    display: flex;
    flex-direction: column;
    width: 100%;
    min-width: 0;
    padding: 2px 0 8px;
  }
  .dnb-pyr-apex {
    position: relative;
    border-radius: 15px;
    padding: 12px 14px;
    background: linear-gradient(145deg, rgba(10, 132, 255, 0.12) 0%, var(--dnb-card) 68%);
    border: 1.5px solid rgba(10, 132, 255, 0.44);
    box-shadow: 0 6px 20px rgba(0, 0, 0, 0.12);
    transition: border-color 0.2s ease, box-shadow 0.2s ease;
  }
  .dnb-pyr-apex[data-spotlight="doing"] {
    border-color: #0a84ff;
    box-shadow: 0 0 0 2.5px rgba(10, 132, 255, 0.28), 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .dnb-pyr-apex[data-spotlight="blocked"] {
    border-color: #ff453a;
    box-shadow: 0 0 0 2.5px rgba(255, 69, 58, 0.32), 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .dnb-pyr-trunk {
    width: 2px;
    height: 18px;
    margin: 0 auto;
    background: var(--dnb-border-strong, rgba(155, 155, 168, 0.55));
    flex-shrink: 0;
    transition: background 0.2s ease;
  }
  .dnb-pyr-trunk[data-tone="doing"] { background: #0a84ff; }
  .dnb-pyr-trunk[data-tone="blocked"] { background: #ff453a; }
  .dnb-pyr-trunk[data-tone="live"] { background: #0a84ff; }

  .dnb-pyr-crossbar {
    height: 2px;
    margin: 0 22%;
    background: var(--dnb-border-strong, rgba(155, 155, 168, 0.52));
    border-radius: 2px;
  }
  .dnb-pyr-crossbar[data-tone="doing"] { background: linear-gradient(90deg, rgba(10,132,255,0.45), #0a84ff, rgba(10,132,255,0.45)); }
  .dnb-pyr-crossbar[data-tone="blocked"] { background: linear-gradient(90deg, rgba(255,69,58,0.45), #ff453a, rgba(255,69,58,0.45)); }

  .dnb-pyr-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(232px, 1fr));
    gap: 12px;
    align-items: start;
    width: 100%;
    min-width: 0;
  }
  .dnb-pyr-grid[data-single="1"] {
    grid-template-columns: minmax(0, 1fr);
  }
  .dnb-pyr-branch {
    position: relative;
    padding-top: 12px;
    min-width: 0;
    transition: opacity 0.2s ease;
  }
  .dnb-pyr-branch::before {
    content: "";
    position: absolute;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    width: 2px;
    height: 12px;
    background: var(--dnb-border-strong, rgba(155, 155, 168, 0.55));
  }
  .dnb-pyr-branch::after {
    content: "";
    position: absolute;
    top: 9px;
    left: 50%;
    transform: translateX(-50%);
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: var(--dnb-border-strong, rgba(165, 165, 178, 0.85));
  }
  .dnb-pyr-branch[data-tone="doing"]::before,
  .dnb-pyr-branch[data-tone="doing"]::after { background: #0a84ff; }
  .dnb-pyr-branch[data-tone="blocked"]::before,
  .dnb-pyr-branch[data-tone="blocked"]::after { background: #ff453a; }
  .dnb-pyr-branch[data-tone="live"]::before,
  .dnb-pyr-branch[data-tone="live"]::after { background: #0a84ff; }

  .dnb-pyr-branch-box {
    position: relative;
    border-radius: 15px;
    min-width: 0;
    transition: all 0.2s ease;
  }
  .dnb-pyr-branch-box[data-spotlight="doing"] {
    padding: 10px 9px 9px;
    margin-top: 4px;
    border: 2px solid #0a84ff;
    background: rgba(10, 132, 255, 0.06);
    box-shadow: 0 0 0 3px rgba(10, 132, 255, 0.16), 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .dnb-pyr-branch-box[data-spotlight="blocked"] {
    padding: 10px 9px 9px;
    margin-top: 4px;
    border: 2px solid #ff453a;
    background: rgba(255, 69, 58, 0.07);
    box-shadow: 0 0 0 3px rgba(255, 69, 58, 0.18), 0 8px 24px rgba(0, 0, 0, 0.18);
  }
  .dnb-pyr-spot-tag {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 9px;
    border-radius: 99px;
    font-size: 10.5px;
    font-weight: 700;
    color: #fff;
    background: #0a84ff;
    margin-bottom: 7px;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.22);
  }
  .dnb-pyr-spot-tag[data-blocked="1"] {
    background: #ff453a;
  }

  .dnb-pyr-agent-card {
    border-radius: 13px;
    padding: 10px 12px;
    background: var(--dnb-elevated, #252529);
    border: 1px solid var(--dnb-border-strong);
    min-width: 0;
    transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
  }
  .dnb-pyr-agent-card[data-running="1"] {
    border-color: rgba(10, 132, 255, 0.52);
    background: linear-gradient(135deg, rgba(10, 132, 255, 0.09) 0%, var(--dnb-elevated, #252529) 72%);
  }
  .dnb-pyr-agent-card[data-focused="doing"] {
    border-color: rgba(10, 132, 255, 0.65);
  }
  .dnb-pyr-agent-card[data-focused="blocked"] {
    border-color: rgba(255, 69, 58, 0.68);
  }

  /* Vertical Tree Connector Spine (竖线连接) for Tier 2+ Subagents & Tasks */
  .dnb-pyr-subtree {
    position: relative;
    margin-left: 14px;
    padding-left: 15px;
    margin-top: 9px;
    border-left: 2px solid var(--dnb-border-strong, rgba(155, 155, 168, 0.46));
    display: flex;
    flex-direction: column;
    gap: 9px;
    min-width: 0;
  }
  .dnb-pyr-subtree[data-tone="doing"] {
    border-left-color: rgba(10, 132, 255, 0.68);
  }
  .dnb-pyr-subtree[data-tone="blocked"] {
    border-left-color: rgba(255, 69, 58, 0.72);
  }
  .dnb-pyr-subtree[data-tone="live"] {
    border-left-color: rgba(10, 132, 255, 0.58);
  }
  .dnb-pyr-subitem {
    position: relative;
    min-width: 0;
  }
  .dnb-pyr-subitem::before {
    content: "";
    position: absolute;
    left: -15px;
    top: 19px;
    width: 13px;
    height: 2px;
    background: var(--dnb-border-strong, rgba(155, 155, 168, 0.48));
  }
  .dnb-pyr-subitem::after {
    content: "";
    position: absolute;
    left: -5px;
    top: 17px;
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--dnb-border-strong, rgba(165, 165, 178, 0.78));
  }
  .dnb-pyr-subitem[data-tone="doing"]::before,
  .dnb-pyr-subitem[data-tone="doing"]::after { background: #0a84ff; }
  .dnb-pyr-subitem[data-tone="blocked"]::before,
  .dnb-pyr-subitem[data-tone="blocked"]::after { background: #ff453a; }
  .dnb-pyr-subitem[data-tone="done"]::after { background: #30d158; }

  .dnb-pyr-task-card {
    border-radius: 13px;
    padding: 10px 12px;
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
    border-left: 3.5px solid var(--dnb-border-strong);
    min-width: 0;
    transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
  }
  .dnb-pyr-task-card:hover {
    border-color: var(--dnb-border-strong);
  }
  .dnb-pyr-task-card[data-status="doing"] {
    border-left-color: #0a84ff;
    border-color: rgba(10, 132, 255, 0.34);
    border-left-width: 3.5px;
    background: linear-gradient(90deg, rgba(10, 132, 255, 0.08) 0%, var(--dnb-card) 64%);
  }
  .dnb-pyr-task-card[data-status="blocked"] {
    border-left-color: #ff453a;
    border-color: rgba(255, 69, 58, 0.42);
    border-left-width: 3.5px;
    background: linear-gradient(90deg, rgba(255, 69, 58, 0.1) 0%, var(--dnb-card) 64%);
  }
  .dnb-pyr-task-card[data-status="todo"] {
    border-left-color: #8e8e93;
  }
  .dnb-pyr-task-card[data-status="done"] {
    border-left-color: #30d158;
    opacity: 0.92;
  }
  .dnb-pyr-task-card[data-spotlight="doing"] {
    border-color: #0a84ff;
    box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.34), 0 6px 18px rgba(0, 0, 0, 0.18);
  }
  .dnb-pyr-task-card[data-spotlight="blocked"] {
    border-color: #ff453a;
    box-shadow: 0 0 0 2px rgba(255, 69, 58, 0.4), 0 6px 18px rgba(0, 0, 0, 0.18);
  }

  /* Laid-out inline status & action pills inside every task card */
  .dnb-pyr-st-row {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-wrap: wrap;
    margin-top: 8px;
    padding-top: 7px;
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-pyr-st-btn {
    height: 21px;
    padding: 0 7.5px;
    border-radius: 99px;
    border: 1px solid var(--dnb-border);
    background: transparent;
    color: var(--dnb-text-3);
    font: inherit;
    font-size: 10.5px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3.5px;
    white-space: nowrap;
    transition: all 0.14s ease;
  }
  .dnb-pyr-st-btn:hover {
    color: var(--dnb-text);
    border-color: var(--dnb-border-strong);
    background: var(--dnb-fill);
  }
  .dnb-pyr-st-btn[data-active="1"][data-st="todo"] {
    color: #a1a1aa;
    border-color: rgba(142, 142, 147, 0.45);
    background: rgba(142, 142, 147, 0.16);
    font-weight: 600;
  }
  .dnb-pyr-st-btn[data-active="1"][data-st="doing"] {
    color: #409cff;
    border-color: rgba(10, 132, 255, 0.5);
    background: rgba(10, 132, 255, 0.16);
    font-weight: 600;
  }
  .dnb-pyr-st-btn[data-active="1"][data-st="blocked"] {
    color: #ff453a;
    border-color: rgba(255, 69, 58, 0.55);
    background: rgba(255, 69, 58, 0.18);
    font-weight: 600;
  }
  .dnb-pyr-st-btn[data-active="1"][data-st="done"] {
    color: #30d158;
    border-color: rgba(48, 209, 88, 0.45);
    background: rgba(48, 209, 88, 0.15);
    font-weight: 600;
  }

  .dnb-pyr-act-row {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    margin-top: 6px;
  }
  .dnb-pyr-act-btn {
    height: 22px;
    padding: 0 8px;
    border-radius: 7px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-elevated, rgba(128,128,136,0.1));
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 3.5px;
    white-space: nowrap;
    transition: all 0.14s ease;
  }
  .dnb-pyr-act-btn:hover {
    color: var(--dnb-text);
    border-color: var(--dnb-border-strong);
    background: var(--dnb-card-hover);
  }
  .dnb-pyr-act-btn[data-accent="1"] {
    color: var(--dnb-accent);
    border-color: rgba(10, 132, 255, 0.34);
    background: rgba(10, 132, 255, 0.1);
  }
  .dnb-pyr-act-btn[data-accent="1"]:hover {
    background: rgba(10, 132, 255, 0.18);
  }
  .dnb-pyr-act-btn[data-danger="1"] {
    color: #ff453a;
    border-color: rgba(255, 69, 58, 0.26);
    background: transparent;
  }
  .dnb-pyr-act-btn[data-danger="1"]:hover {
    background: rgba(255, 69, 58, 0.12);
    border-color: rgba(255, 69, 58, 0.45);
  }

  /* DAG Zoom Canvas (optional的全景画布视图) */
  .dnb-canvas {
    position: relative;
    border-radius: 14px;
    border: 1px solid var(--dnb-border);
    background-color: var(--dnb-card);
    background-image: radial-gradient(var(--dnb-border-strong) 1px, transparent 1px);
    background-size: 18px 18px;
    overflow: auto;
    min-height: 420px;
  }
  .dnb-canvas::-webkit-scrollbar { width: 5px; height: 5px; }
  .dnb-canvas::-webkit-scrollbar-thumb {
    background: var(--dsw-alias-scrollbar-bg-l1, rgba(128,128,136,0.24));
    border-radius: 99px;
  }

  @keyframes dnb-pulse {
    0%, 100% { opacity: 0.85; stroke-width: 1.8px; }
    50% { opacity: 0.25; stroke-width: 4.5px; }
  }
  .dnb-pulse-ring { animation: dnb-pulse 2s ease-in-out infinite; }

  @keyframes dnb-live-dot {
    0%, 100% { opacity: 1; transform: scale(1); }
    50% { opacity: 0.45; transform: scale(0.82); }
  }
  .dnb-live-dot {
    width: 6.5px;
    height: 6.5px;
    border-radius: 50%;
    display: inline-block;
    flex-shrink: 0;
    animation: dnb-live-dot 1.5s ease-in-out infinite;
  }

  .dnb-spin-ring {
    width: var(--dnb-spin-size, 10px);
    height: var(--dnb-spin-size, 10px);
    border-radius: 50%;
    border: 1.65px solid rgba(161, 161, 170, 0.28);
    border-top-color: currentColor;
    display: inline-block;
    flex-shrink: 0;
    box-sizing: border-box;
    animation: dnb-spin 0.85s linear infinite;
  }
  .dnb-svg-spin {
    transform-box: fill-box;
    transform-origin: center;
    animation: dnb-spin 0.85s linear infinite;
  }

  @keyframes dnb-spotlight-march {
    to { stroke-dashoffset: -28px; }
  }
  .dnb-spotlight-dash {
    animation: dnb-spotlight-march 1.3s linear infinite;
  }

  @keyframes dnb-spotlight-breathe {
    0%, 100% { opacity: 0.26; }
    50% { opacity: 0.48; }
  }
  .dnb-spotlight-halo {
    animation: dnb-spotlight-breathe 2s ease-in-out infinite;
  }

  /* Eye-catching Objective Status Badges (推进中 / 受阻 / 待推进 / 已完成) */
  .dnb-status-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 20px;
    padding: 0 7.5px;
    border-radius: 99px;
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: 0.1px;
    white-space: nowrap;
    flex-shrink: 0;
    border: 1px solid transparent;
  }
  .dnb-status-badge[data-status="doing"] {
    background: rgba(10, 132, 255, 0.16);
    border-color: rgba(10, 132, 255, 0.44);
    color: #409cff;
  }
  .dnb-status-badge[data-status="blocked"] {
    background: rgba(255, 69, 58, 0.2);
    border-color: rgba(255, 69, 58, 0.56);
    color: #ff453a;
  }
  .dnb-status-badge[data-status="todo"] {
    background: rgba(142, 142, 147, 0.16);
    border-color: rgba(142, 142, 147, 0.34);
    color: #a1a1aa;
  }
  .dnb-status-badge[data-status="done"] {
    background: rgba(48, 209, 88, 0.14);
    border-color: rgba(48, 209, 88, 0.34);
    color: #30d158;
  }

  /* Prominent Advancing & Blocked Objective Radar Cards */
  .dnb-radar-strip {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 10px;
  }
  .dnb-radar-card {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 8px 10px 8px 11px;
    border-radius: 12px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    cursor: pointer;
    transition: transform 0.15s cubic-bezier(0.32, 0.72, 0, 1), border-color 0.16s ease, box-shadow 0.16s ease, background 0.16s ease;
  }
  .dnb-radar-card:hover {
    background: var(--dnb-card-hover);
    transform: translateY(-1px);
  }
  .dnb-radar-card:active {
    transform: scale(0.985);
  }
  .dnb-radar-card[data-kind="doing"] {
    border-left: 3.5px solid #0a84ff;
    background: linear-gradient(90deg, rgba(10, 132, 255, 0.12) 0%, var(--dnb-card) 70%);
    border-color: rgba(10, 132, 255, 0.34);
    border-left-color: #0a84ff;
  }
  .dnb-radar-card[data-kind="blocked"] {
    border-left: 3.5px solid #ff453a;
    background: linear-gradient(90deg, rgba(255, 69, 58, 0.15) 0%, var(--dnb-card) 70%);
    border-color: rgba(255, 69, 58, 0.42);
    border-left-color: #ff453a;
  }
  .dnb-radar-card[data-focused="1"] {
    box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.36), 0 6px 16px rgba(0, 0, 0, 0.18);
  }
  .dnb-radar-card[data-kind="blocked"][data-focused="1"] {
    box-shadow: 0 0 0 2px rgba(255, 69, 58, 0.42), 0 6px 16px rgba(0, 0, 0, 0.18);
  }

  /* Active Spotlight Banner above Pyramid Canvas */
  .dnb-focus-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    margin-bottom: 8px;
    border-radius: 11px;
    border: 1px solid rgba(10, 132, 255, 0.45);
    background: rgba(10, 132, 255, 0.13);
    font-size: 11.5px;
    animation: dnb-enter 0.18s ease-out;
  }
  .dnb-focus-banner[data-blocked="1"] {
    border-color: rgba(255, 69, 58, 0.5);
    background: rgba(255, 69, 58, 0.14);
  }

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
    width: 16px;
    height: 16px;
    padding: 0;
    border-radius: 5px;
    border: 1px solid var(--dnb-border-strong);
    background: transparent;
    color: transparent;
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.14s ease;
  }
  .dnb-bound-check:hover {
    border-color: var(--dnb-accent);
  }
  .dnb-bound-check[data-checked="1"] {
    border-color: var(--dnb-primary-bg, #2563eb);
    background: var(--dnb-primary-bg, #2563eb);
    color: var(--dnb-primary-fg, #fff);
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
    background: var(--dnb-popover, #252528);
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
    height: 26px;
    padding: 0 10px;
    border-radius: 99px;
    border: 1px solid var(--dnb-border);
    background: transparent;
    color: var(--dnb-text-3);
    font: inherit;
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    display: inline-flex;
    align-items: center;
    gap: 4px;
    transition: all 0.15s ease;
  }
  .dnb-sec-chip:hover {
    color: var(--dnb-text-2);
    background: var(--dnb-card);
  }
  .dnb-sec-chip[data-active="1"] {
    background: rgba(10, 132, 255, 0.15);
    border-color: rgba(10, 132, 255, 0.42);
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
    padding: 4px 0;
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

  /* ---------------- Engineering Memory Filing Cabinet (档案柜) ---------------- */
  @keyframes dnb-drawer-slide {
    from { opacity: 0; transform: translateY(-6px); }
    to { opacity: 1; transform: translateY(0); }
  }
  @keyframes dnb-point-open {
    from { opacity: 0; transform: translateY(-3px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .dnb-vault-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 11px;
    border-radius: 12px;
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
    margin-bottom: 8px;
  }

  .dnb-desk-tray {
    border-radius: 13px;
    padding: 9px 11px;
    margin-bottom: 10px;
    background: rgba(245, 158, 11, 0.08);
    border: 1px solid rgba(245, 158, 11, 0.34);
  }

  .dnb-cabinet-drawer {
    position: relative;
    margin-top: 9px;
    margin-bottom: 11px;
  }
  .dnb-folder-ear {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 18px;
    padding: 0 10px 0 8px;
    margin-left: 10px;
    border-radius: 7px 9px 0 0;
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
    border-bottom: none;
    font-size: 10px;
    font-weight: 600;
    color: var(--dnb-text-2);
    letter-spacing: 0.02em;
  }
  .dnb-cabinet-drawer[data-open="1"] .dnb-folder-ear {
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
  }
  .dnb-drawer-box {
    border-radius: 11px 13px 13px 13px;
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
    overflow: hidden;
    transition: border-color 0.16s ease, background 0.16s ease;
  }
  .dnb-cabinet-drawer[data-open="1"] .dnb-drawer-box {
    border-color: var(--dnb-border-strong);
  }
  .dnb-drawer-front {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 11px;
    cursor: pointer;
    user-select: none;
    transition: background 0.14s ease;
  }
  .dnb-drawer-front:hover {
    background: var(--dnb-card-hover);
  }
  .dnb-drawer-spine {
    width: 3.5px;
    height: 28px;
    border-radius: 99px;
    flex-shrink: 0;
  }
  .dnb-drawer-handle {
    width: 24px;
    height: 20px;
    border-radius: 6px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-fill);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--dnb-text-2);
    flex-shrink: 0;
    transition: border-color 0.15s ease, color 0.15s ease;
  }
  .dnb-cabinet-drawer[data-open="1"] .dnb-drawer-handle {
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
  }
  .dnb-drawer-well {
    border-top: 1px solid var(--dnb-border);
    padding: 8px 9px 10px;
    background: rgba(128, 128, 136, 0.04);
    display: flex;
    flex-direction: column;
    gap: 8px;
    animation: dnb-drawer-slide 0.18s ease-out;
  }

  /* Paperclipped Dossier Card */
  .dnb-dossier-card {
    position: relative;
    border-radius: 11px;
    background: var(--dnb-elevated);
    border: 1px solid var(--dnb-border);
    margin-top: 3px;
    transition: border-color 0.15s ease;
    animation: dnb-drawer-slide 0.18s ease-out both;
  }
  .dnb-dossier-card:hover {
    border-color: var(--dnb-border-strong);
  }
  .dnb-dossier-card[data-open="1"] {
    border-color: rgba(10, 132, 255, 0.42);
  }
  .dnb-dossier-card[data-out="1"] {
    border-color: rgba(245, 158, 11, 0.48);
  }
  .dnb-paperclip-pin {
    position: absolute;
    top: -6px;
    left: 10px;
    width: 20px;
    height: 24px;
    border: none;
    padding: 0;
    background: transparent;
    cursor: pointer;
    z-index: 2;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s ease;
  }
  .dnb-paperclip-pin:hover {
    transform: translateY(-1.5px) scale(1.08);
  }
  .dnb-dossier-head {
    padding: 9px 10px 8px 33px;
    cursor: pointer;
  }
  .dnb-dossier-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex-wrap: wrap;
    padding: 0 10px 8px 33px;
  }

  /* Structured Memory Points & Sub-point Details */
  .dnb-points-sheet {
    border-top: 1px dashed var(--dnb-border-strong);
    padding: 8px 10px 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
    animation: dnb-point-open 0.16s ease-out;
  }
  .dnb-mem-point {
    border-radius: 9px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    overflow: hidden;
    transition: border-color 0.14s ease, background 0.14s ease;
  }
  .dnb-mem-point:hover {
    border-color: var(--dnb-border-strong);
  }
  .dnb-mem-point[data-open="1"] {
    border-color: rgba(10, 132, 255, 0.36);
  }
  .dnb-mem-point-row {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 7px 9px;
    cursor: pointer;
    user-select: none;
  }
  .dnb-mem-point-idx {
    min-width: 20px;
    height: 18px;
    padding: 0 5px;
    border-radius: 5px;
    background: var(--dnb-fill);
    color: var(--dnb-text-2);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 10.5px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
  }
  .dnb-mem-point[data-open="1"] .dnb-mem-point-idx {
    background: rgba(10, 132, 255, 0.16);
    color: var(--dnb-accent);
  }
  .dnb-subpoint-detail {
    border-top: 1px solid var(--dnb-border);
    padding: 8px 10px;
    background: rgba(128, 128, 136, 0.05);
    font-size: 11.5px;
    line-height: 1.58;
    color: var(--dnb-text);
    white-space: pre-wrap;
    word-break: break-word;
    animation: dnb-point-open 0.15s ease-out;
  }
  .dnb-mini-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 10px;
    border-radius: 8px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    color: var(--dnb-text-2);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
  }
  .dnb-mini-btn:hover {
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
    background: var(--dnb-card-hover);
  }
  .dnb-mini-btn[data-tone="amber"] {
    border-color: rgba(245, 158, 11, 0.45);
    background: rgba(245, 158, 11, 0.12);
    color: #f59e0b;
  }
  .dnb-mini-btn[data-tone="accent"] {
    border-color: rgba(10, 132, 255, 0.42);
    background: rgba(10, 132, 255, 0.11);
    color: var(--dnb-accent);
  }

  /* vNext Micro-Flat Components: Tactical Cockpit, Scoped Modals, Goal Approval & Cold Vault */
  .dnb-sec-bar {
    position: relative;
  }
  .dnb-modal-backdrop {
    position: absolute;
    inset: 0;
    z-index: 80;
    background: rgba(0, 0, 0, 0.46);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 12px;
  }
  .dnb-modal-card {
    width: 100%;
    max-height: 92%;
    overflow-y: auto;
    border-radius: 12px;
    background: var(--dnb-elevated);
    border: 1px solid var(--dnb-border-strong);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
    padding: 14px;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }
  .dnb-plus-btn {
    width: 28px;
    height: 28px;
    padding: 0;
    margin: 0;
    box-sizing: border-box;
    border-radius: 50%;
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-card);
    color: var(--dnb-text-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    cursor: pointer;
    line-height: 0;
    transition: border-color 0.14s ease, background 0.14s ease, color 0.14s ease;
  }
  .dnb-plus-btn:hover {
    border-color: var(--dnb-accent);
    color: var(--dnb-text);
  }
  .dnb-plus-btn[data-active="1"] {
    border-color: rgba(10, 132, 255, 0.48);
    background: rgba(10, 132, 255, 0.14);
    color: var(--dnb-accent);
  }
  .dnb-plus-btn[data-danger="1"] {
    border-color: rgba(245, 158, 11, 0.55);
    background: rgba(245, 158, 11, 0.16);
    color: #f59e0b;
  }
  .dnb-tactical-pop {
    position: absolute;
    left: 12px;
    right: calc(12px + var(--dnb-safe-right, 0px));
    bottom: calc(100% + 6px);
    z-index: 65;
    border-radius: 12px;
    background: var(--dnb-popover);
    border: 1.5px solid rgba(96, 165, 250, 0.36);
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    max-height: 360px;
    overflow-y: auto;
  }
  .dnb-tactical-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 5px 0;
    border-bottom: 1px solid var(--dnb-border);
  }
  .dnb-tactical-row:last-of-type {
    border-bottom: none;
  }
  .dnb-tactical-strip {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    padding-bottom: 6px;
  }
  .dnb-tac-chip {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 26px;
    padding: 0 11px;
    border-radius: 99px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    color: var(--dnb-text-2);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .dnb-tac-chip[data-tone="amber"] {
    border-color: rgba(245, 158, 11, 0.45);
    background: rgba(245, 158, 11, 0.12);
    color: #f59e0b;
  }
  .dnb-tac-chip[data-tone="accent"] {
    border-color: rgba(10, 132, 255, 0.42);
    background: rgba(10, 132, 255, 0.11);
    color: var(--dnb-accent);
  }
  .dnb-tac-chip[data-tone="red"] {
    border-color: rgba(248, 113, 113, 0.52);
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.12);
  }
  .dnb-stop-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    height: 26px;
    padding: 0 11px;
    border-radius: 99px;
    border: 1px solid rgba(255, 69, 58, 0.55);
    background: rgba(255, 69, 58, 0.16);
    color: #ff453a;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    margin-left: auto;
    transition: background 0.15s ease;
  }
  .dnb-stop-btn:hover {
    background: rgba(255, 69, 58, 0.24);
  }
  .dnb-six-brief {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 2px;
  }
  .dnb-six-row {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 9px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-elevated);
  }
  .dnb-six-tag {
    flex-shrink: 0;
    font-size: 10.5px;
    font-weight: 700;
    padding: 2px 7px;
    border-radius: 6px;
    line-height: 1.35;
    margin-top: 1px;
  }
  .dnb-batch-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 11px;
    margin-bottom: 9px;
    border-radius: 10px;
    border: 1px solid rgba(10, 132, 255, 0.42);
    background: rgba(10, 132, 255, 0.10);
  }
  .dnb-perm-grid {
    display: flex;
    flex-direction: column;
    gap: 3px;
    margin-top: 5px;
  }
  .dnb-perm-row {
    display: flex;
    align-items: flex-start;
    gap: 5px;
    font-size: 10.5px;
    line-height: 1.38;
    color: var(--dnb-text-3);
    white-space: normal;
  }
  .dnb-perm-who {
    flex-shrink: 0;
    font-weight: 600;
    color: var(--dnb-text-2);
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
    border-radius: 5px;
    padding: 0 5px;
    font-size: 10px;
  }
  .dnb-archive-check {
    width: 15px;
    height: 15px;
    flex-shrink: 0;
    accent-color: var(--dnb-accent);
    cursor: pointer;
  }
  .dnb-stepper {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    border: 1px solid var(--dnb-border);
    border-radius: 7px;
    background: var(--dnb-card);
    padding: 1px 3px;
  }
  .dnb-stepper button {
    width: 18px;
    height: 18px;
    border: none;
    background: transparent;
    color: var(--dnb-text-2);
    cursor: pointer;
    font-size: 12px;
    border-radius: 4px;
    padding: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  .dnb-stepper button:hover {
    background: var(--dnb-fill);
    color: var(--dnb-text);
  }
  .dnb-stepper span {
    min-width: 26px;
    text-align: center;
    font-size: 11px;
    font-weight: 600;
    color: var(--dnb-text);
  }
  .dnb-disclaimer-box {
    border-radius: 8px;
    border: 1px solid rgba(245, 158, 11, 0.36);
    background: rgba(245, 158, 11, 0.08);
    padding: 8px 10px;
    font-size: 11px;
    line-height: 1.5;
    color: var(--dnb-text-2);
  }
  .dnb-disclaimer-box strong {
    color: #f59e0b;
  }
  .dnb-goal-approval-card {
    border-radius: 10px;
    border: 1px solid rgba(48, 209, 88, 0.45);
    background: rgba(48, 209, 88, 0.08);
    padding: 10px 12px;
    margin-bottom: 10px;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .dnb-cab-bar {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    margin-bottom: 8px;
  }
  .dnb-precip-box {
    margin-top: 12px;
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    overflow: hidden;
  }
  .dnb-vault-seg {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 4px;
    padding: 4px;
    border-radius: 12px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-fill);
    margin-bottom: 8px;
  }
  .dnb-vault-seg-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 28px;
    padding: 4px 6px;
    border-radius: 9px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-2);
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
  }
  .dnb-vault-seg-btn:hover {
    color: var(--dnb-text);
    background: rgba(255, 255, 255, 0.04);
  }
  .dnb-vault-seg-btn[data-active="1"] {
    background: var(--dnb-elevated);
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.16);
  }
  .dnb-vault-seg-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 16px;
    height: 16px;
    padding: 0 4px;
    border-radius: 99px;
    font-size: 10px;
    font-weight: 700;
    background: var(--dnb-card);
    color: var(--dnb-text-2);
  }
  .dnb-vault-seg-btn[data-active="1"] .dnb-vault-seg-badge {
    background: rgba(10, 132, 255, 0.16);
    color: var(--dnb-accent);
  }
  .dnb-vault-perm-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    margin-bottom: 9px;
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    font-size: 11px;
    line-height: 1.45;
    color: var(--dnb-text-2);
  }
  .dnb-drawer-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 11px;
    cursor: pointer;
    border-left: 3px solid transparent;
    transition: background 0.14s ease;
  }
  .dnb-drawer-head:hover {
    background: var(--dnb-hover);
  }
  /* v1.2.1 4-Tier Permission Cards, Operation Approval & Chief Risk Modals */
  .dnb-perm-pop {
    position: absolute;
    left: 12px;
    right: calc(12px + var(--dnb-safe-right, 0px));
    bottom: calc(100% + 6px);
    max-height: min(68vh, 520px);
    overflow-y: auto;
    z-index: 70;
    padding: 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dnb-perm-card {
    border-radius: 12px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    padding: 10px 11px;
    cursor: pointer;
    transition: border-color 0.16s ease, background 0.16s ease, box-shadow 0.16s ease;
  }
  .dnb-perm-card:hover {
    border-color: var(--dnb-border-strong);
    background: var(--dnb-card-hover);
  }
  .dnb-perm-card[data-active="1"] {
    border-color: var(--dnb-primary-bg, #2563eb);
    box-shadow: 0 0 0 1px rgba(37, 99, 235, 0.25);
    background: rgba(37, 99, 235, 0.08);
  }
  .dnb-perm-card[data-tier="chief"][data-active="1"] {
    border-color: #d97706;
    box-shadow: 0 0 0 1px rgba(217, 119, 6, 0.28);
    background: rgba(217, 119, 6, 0.1);
  }
  .dnb-perm-badge {
    display: inline-flex;
    align-items: center;
    padding: 2px 8px;
    border-radius: 99px;
    font-size: 10px;
    font-weight: 700;
    line-height: 1.3;
    flex-shrink: 0;
  }
  .dnb-perm-badge[data-tone="green"] {
    background: rgba(48, 209, 88, 0.16);
    color: #34d399;
  }
  .dnb-perm-badge[data-tone="blue"] {
    background: rgba(37, 99, 235, 0.18);
    color: #60a5fa;
  }
  .dnb-perm-badge[data-tone="amber"] {
    background: rgba(245, 158, 11, 0.18);
    color: #fbbf24;
  }
  .dnb-perm-subcode {
    font-size: 13px;
    font-weight: 800;
    letter-spacing: 0.03em;
    margin-top: 2px;
    color: var(--dnb-text);
  }
  .dnb-perm-bullets {
    margin: 5px 0 4px 15px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
    font-size: 11px;
    line-height: 1.45;
    color: var(--dnb-text-2);
  }
  .dnb-perm-foot {
    font-size: 10.5px;
    color: var(--dnb-text-3);
    line-height: 1.4;
  }
  .dnb-pipe-bar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 4px;
    padding: 6px 8px;
    border-radius: 8px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    font-size: 10.5px;
    color: var(--dnb-text-2);
  }
  .dnb-pipe-node {
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--dnb-fill);
    color: var(--dnb-text);
    font-weight: 600;
  }
  .dnb-op-box {
    border-radius: 10px;
    border: 1px solid var(--dnb-border-strong);
    background: var(--dnb-card);
    padding: 10px 12px;
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .dnb-op-kv {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--dnb-text);
  }
  .dnb-op-k {
    color: var(--dnb-text-2);
    font-weight: 600;
    flex-shrink: 0;
  }
  .dnb-op-code {
    display: inline-block;
    padding: 1px 6px;
    border-radius: 5px;
    background: var(--dnb-fill);
    border: 1px solid var(--dnb-border);
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11.5px;
    word-break: break-all;
  }
  .dnb-risk-box {
    border-radius: 10px;
    border: 1px solid rgba(245, 158, 11, 0.38);
    background: rgba(245, 158, 11, 0.08);
    padding: 11px 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--dnb-text);
  }
  .dnb-risk-check {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    font-size: 12px;
    line-height: 1.45;
    color: var(--dnb-text);
    cursor: pointer;
    user-select: none;
  }
  .dnb-pending-banner {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    margin-bottom: 6px;
    border-radius: 9px;
    font-size: 11.5px;
    font-weight: 600;
    cursor: pointer;
  }
  .dnb-audit-row {
    padding: 7px 9px;
    border-radius: 8px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    font-size: 11px;
    line-height: 1.45;
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .dnb-sug-group {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin: 0 12px 8px;
  }
  .dnb-sug-group .dnb-sug-card {
    margin: 0;
  }
  .dnb-sug-top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 10px;
    border: 1px solid rgba(10, 132, 255, 0.34);
    background: rgba(10, 132, 255, 0.08);
    flex-wrap: wrap;
  }
  .dnb-sug-meta-row {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    margin-top: 2px;
  }
  .dnb-filter-seg {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border-radius: 8px;
    background: var(--dnb-fill);
    border: 1px solid var(--dnb-border);
  }
  .dnb-filter-btn {
    border: none;
    background: transparent;
    color: var(--dnb-text-3);
    font-size: 10.5px;
    font-weight: 600;
    padding: 2px 7px;
    border-radius: 6px;
    cursor: pointer;
  }
  .dnb-filter-btn[data-active="1"] {
    background: var(--dnb-card);
    color: var(--dnb-text);
    box-shadow: 0 1px 2px rgba(0, 0, 0, 0.14);
  }
  .dnb-qa-stream {
    display: flex;
    flex-direction: column;
    gap: 11px;
    padding: 10px;
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-qa-turn-box {
    border-radius: 14px;
    border: 2px solid rgba(56, 189, 248, 0.72);
    background: linear-gradient(180deg, rgba(14, 165, 233, 0.09) 0%, var(--dnb-card) 100%);
    overflow: hidden;
    box-shadow:
      0 6px 18px rgba(0, 0, 0, 0.24),
      0 0 0 1px rgba(56, 189, 248, 0.20) inset,
      0 0 14px rgba(14, 165, 233, 0.14);
    transition: border-color 0.16s ease, box-shadow 0.16s ease;
  }
  .dnb-qa-turn-box[data-turn-kind="system"] {
    border-color: rgba(16, 185, 129, 0.68);
    background: linear-gradient(180deg, rgba(16, 185, 129, 0.09) 0%, var(--dnb-card) 100%);
    box-shadow:
      0 6px 18px rgba(0, 0, 0, 0.22),
      0 0 0 1px rgba(16, 185, 129, 0.18) inset,
      0 0 12px rgba(16, 185, 129, 0.12);
  }
  .dnb-turn-question {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 9px 12px;
    cursor: pointer;
    user-select: none;
    background: rgba(56, 189, 248, 0.12);
    border-bottom: 1.5px solid rgba(56, 189, 248, 0.36);
    transition: background 0.14s ease;
  }
  .dnb-turn-question:hover {
    background: rgba(56, 189, 248, 0.18);
  }
  .dnb-qa-turn-box[data-turn-kind="system"] .dnb-turn-question {
    background: rgba(16, 185, 129, 0.11);
    border-bottom-color: rgba(16, 185, 129, 0.34);
  }
  .dnb-qa-turn-box[data-turn-kind="system"] .dnb-turn-question:hover {
    background: rgba(16, 185, 129, 0.17);
  }
  .dnb-qa-turn-box[data-collapsed="1"] .dnb-turn-question {
    border-bottom: none;
  }
  .dnb-turn-replies {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 9px 12px;
  }
  .dnb-turn-reply-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
    padding: 7px 10px;
    border-radius: 9px;
    border: 1px solid rgba(56, 189, 248, 0.26);
    border-left: 3.5px solid #38bdf8;
    background: rgba(14, 165, 233, 0.055);
  }
  .dnb-turn-reply-item[data-role="receipt"] {
    border-color: rgba(52, 211, 153, 0.28);
    border-left: 3.5px solid #10b981;
    background: rgba(16, 185, 129, 0.06);
  }
  .dnb-qa-card {
    border-radius: 11px;
    padding: 9px 12px;
    border: 1px solid rgba(148, 163, 184, 0.30);
    border-left: 3.5px solid #94a3b8;
    background: rgba(148, 163, 184, 0.055);
  }
  .dnb-qa-stream > .dnb-qa-card + .dnb-qa-card,
  .dnb-qa-stream > .dnb-qa-card + .dnb-receipt-card,
  .dnb-qa-stream > .dnb-receipt-card + .dnb-qa-card,
  .dnb-qa-stream > .dnb-receipt-card + .dnb-receipt-card {
    border-top: 1px solid rgba(148, 163, 184, 0.30);
  }
  .dnb-qa-card[data-role="chief"] {
    border: 1px solid rgba(56, 189, 248, 0.36);
    border-left: 3.5px solid #38bdf8;
    background: rgba(14, 165, 233, 0.065);
  }
  .dnb-qa-stream > .dnb-qa-card[data-role="chief"] + .dnb-qa-card[data-role="chief"],
  .dnb-qa-stream > .dnb-cell + .dnb-qa-card[data-role="chief"] {
    border-top: 1px solid rgba(56, 189, 248, 0.36);
  }
  .dnb-receipt-card {
    border-radius: 11px;
    padding: 9px 12px;
    border: 1px solid rgba(52, 211, 153, 0.38);
    border-left: 3.5px solid #10b981;
    background: rgba(16, 185, 129, 0.065);
  }
  .dnb-qa-stream > .dnb-cell + .dnb-receipt-card {
    border-top: 1px solid rgba(52, 211, 153, 0.38);
  }
  .dnb-wall-box {
    margin-bottom: 12px;
    border-radius: 14px;
    border: 1.25px solid rgba(248, 113, 113, 0.36);
    background: rgba(239, 68, 68, 0.045);
    overflow: hidden;
  }
  .dnb-wall-item {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 9px 12px;
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-wall-actions-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 5px;
    width: 100%;
    margin-top: 2px;
  }
  .dnb-wall-scope-btn {
    height: 22px;
    padding: 0 7px;
    border-radius: 99px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    color: var(--dnb-text-2);
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.14s ease;
  }
  .dnb-wall-scope-btn[data-active="1"] {
    border-color: rgba(248, 113, 113, 0.55);
    background: rgba(239, 68, 68, 0.15);
    color: #f87171;
  }
  .dnb-receipt-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 7px;
    border-radius: 99px;
    font-size: 10.5px;
    font-weight: 700;
    color: #34d399;
    background: rgba(48, 209, 88, 0.14);
  }
  .dnb-qa-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 7px;
    border-radius: 99px;
    font-size: 10.5px;
    font-weight: 700;
    color: var(--dnb-text-2);
    background: var(--dnb-fill);
  }
  .dnb-qa-badge[data-role="chief"] {
    color: var(--dnb-accent);
    background: rgba(10, 132, 255, 0.12);
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
  @media (prefers-color-scheme: light) {
    .dnb-chief-fx-stage {
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
`

export function Style() {
  return h('style', { 'data-dnb': '3' }, CSS)
}
