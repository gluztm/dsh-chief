/**
 * src/client/styles/archives.js — 档案柜、回形针卷宗卡与“一沓纸”桌面叠放样式
 *
 * 【核心职责】
 *   承载工程记忆档案柜抽屉、回形针纸质卷宗卡（Paperclipped Dossier）、结构化要点与子要点，
 *   以及 v1.5.0 极简顶栏、桌面页与“一沓纸”（Top-Down Stacked Paper Dossiers）叠放展开样式。
 *
 * 【边界约定】
 *   - 仅服务于「档案」页签及交接/沉淀卡片视觉表现，不依赖其他业务页签专属样式。
 */

export const CSS_ARCHIVES = `
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
    border-radius: 10px;
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
    overflow: hidden;
    transition: border-color 0.16s ease, background 0.16s ease;
  }
  .dnb-cabinet-drawer[data-open="1"] .dnb-drawer-box {
    border-color: var(--dnb-border-strong);
    overflow: visible;
  }
  .dnb-drawer-front {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 10px;
    cursor: pointer;
    user-select: none;
    transition: background 0.14s ease;
  }
  .dnb-drawer-front:hover {
    background: var(--dnb-card-hover);
  }
  .dnb-drawer-spine {
    width: 3px;
    height: 20px;
    border-radius: 99px;
    flex-shrink: 0;
  }
  .dnb-drawer-handle {
    width: 22px;
    height: 18px;
    border-radius: 5px;
    border: 1px solid transparent;
    background: transparent;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    color: var(--dnb-text-3);
    flex-shrink: 0;
    transition: color 0.15s ease;
  }
  .dnb-cabinet-drawer[data-open="1"] .dnb-drawer-handle {
    color: var(--dnb-text-2);
  }
  .dnb-drawer-well {
    border-top: 1px solid var(--dnb-border);
    padding: 8px 10px 10px;
    background: rgba(128, 128, 136, 0.03);
    display: flex;
    flex-direction: column;
    gap: 6px;
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
    top: 7px;
    left: 11px;
    width: 14px;
    height: 18px;
    border: none;
    padding: 0;
    background: transparent;
    cursor: pointer;
    z-index: 2;
    opacity: 0.78;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s ease, opacity 0.15s ease;
  }
  .dnb-paperclip-pin:hover {
    opacity: 1;
    transform: scale(1.12);
  }
  .dnb-dossier-head {
    padding: 8px 11px 7px 30px;
    cursor: pointer;
  }
  .dnb-dossier-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    flex-wrap: wrap;
    padding: 6px 0 0;
    margin-top: 6px;
    border-top: 1px dashed var(--dnb-border);
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
    height: 24px;
    padding: 0 8px;
    border-radius: 7px;
    border: 1px solid var(--dnb-border);
    background: transparent;
    color: var(--dnb-text-2);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    transition: border-color 0.14s ease, color 0.14s ease, background 0.14s ease;
  }
  .dnb-mini-btn:hover {
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
    background: var(--dnb-fill);
  }
  .dnb-mini-btn[data-tone="amber"] {
    border-color: rgba(245, 158, 11, 0.34);
    background: rgba(245, 158, 11, 0.09);
    color: #f59e0b;
  }
  .dnb-mini-btn[data-tone="accent"] {
    border-color: rgba(37, 99, 235, 0.32);
    background: rgba(37, 99, 235, 0.09);
    color: var(--dnb-accent);
  }

  /* ── v1.5.0 Minimal Strip Bars, Menus, Desktop Page & Stacked Top-Down Paper Dossiers ── */
  .dnb-strip-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    min-height: 34px;
    padding: 4px 10px 4px 12px;
    margin-bottom: 8px;
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    position: relative;
  }
  .dnb-strip-bar::before {
    content: "";
    position: absolute;
    left: 0;
    top: 6px;
    bottom: 6px;
    width: 3px;
    border-radius: 0 99px 99px 0;
    background: var(--dnb-strip-color, var(--dnb-accent));
  }
  .dnb-more-wrap {
    position: relative;
    display: inline-flex;
    align-items: center;
  }
  .dnb-more-menu {
    position: absolute;
    right: 0;
    top: calc(100% + 5px);
    min-width: 176px;
    max-width: 224px;
    padding: 5px;
    border-radius: 11px;
    border: 1px solid var(--dnb-border-strong);
    background-color: #1f2024;
    background-image: linear-gradient(var(--dnb-popover), var(--dnb-popover));
    box-shadow: 0 14px 32px rgba(0, 0, 0, 0.34);
    backdrop-filter: blur(16px);
    z-index: 88;
    display: flex;
    flex-direction: column;
    gap: 2px;
    animation: dnb-point-open 0.14s ease-out;
  }
  .dnb-more-menu[data-pos="up"] {
    top: auto;
    bottom: calc(100% + 5px);
  }
  .dnb-more-menu[data-align="left"] {
    left: 0;
    right: auto;
  }
  .dnb-more-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    width: 100%;
    padding: 6px 9px;
    border-radius: 7px;
    border: none;
    background: transparent;
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 11.5px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
    transition: background 0.12s ease, color 0.12s ease;
  }
  .dnb-more-item:hover:not(:disabled) {
    background: var(--dnb-fill);
    color: var(--dnb-text);
  }
  .dnb-more-item:disabled {
    opacity: 0.38;
    cursor: not-allowed;
  }
  .dnb-more-item[data-danger="1"] {
    color: #f87171;
  }
  .dnb-more-item[data-active="1"] {
    color: var(--dnb-accent);
    background: rgba(37, 99, 235, 0.10);
  }
  .dnb-more-sep {
    height: 1px;
    background: var(--dnb-border);
    margin: 3px 5px;
  }
  .dnb-text-filter-bar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
    padding: 2px 2px 6px;
    font-size: 11px;
    color: var(--dnb-text-3);
  }
  .dnb-text-filter-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.18);
    background: rgba(148, 163, 184, 0.07);
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.14s ease, background 0.14s ease, border-color 0.14s ease;
  }
  .dnb-text-filter-btn:hover {
    color: var(--dnb-text);
    background: var(--dnb-card-hover);
    border-color: var(--dnb-border-strong);
  }
  .dnb-text-filter-btn[data-active="1"] {
    color: #7dd3fc;
    font-weight: 600;
    background: rgba(56, 189, 248, 0.16);
    border-color: rgba(56, 189, 248, 0.42);
  }

  .dnb-run-mode-pill {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    padding: 2px;
    border-radius: 999px;
    background: var(--dnb-fill);
    border: 1px solid var(--dnb-border);
  }
  .dnb-run-mode-btn {
    border: none;
    background: transparent;
    color: var(--dnb-text-3);
    font-size: 10.5px;
    font-weight: 500;
    padding: 2.5px 6.5px;
    border-radius: 999px;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease;
    display: inline-flex;
    align-items: center;
    gap: 3px;
    line-height: 1.25;
  }
  .dnb-run-mode-btn:hover {
    color: var(--dnb-text);
  }
  .dnb-run-mode-btn[data-active="1"][data-rm="off"] {
    background: var(--dnb-elevated);
    color: var(--dnb-text);
    font-weight: 600;
  }
  .dnb-run-mode-btn[data-active="1"][data-rm="patrol"] {
    background: rgba(56, 189, 248, 0.14);
    color: #38bdf8;
    font-weight: 600;
  }
  .dnb-run-mode-btn[data-active="1"][data-rm="managed"] {
    background: rgba(16, 185, 129, 0.15);
    color: #34d399;
    font-weight: 600;
  }

  .dnb-desktop-zone {
    position: relative;
    padding: 12px;
    border-radius: 12px;
    background: linear-gradient(135deg, rgba(245, 158, 11, 0.08) 0%, var(--dnb-card) 44%);
    border: 1px solid var(--dnb-border);
    border-left: 3.5px solid rgba(245, 158, 11, 0.88);
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  html[data-ds-theme-source="light"] .dnb-desktop-zone {
    background: linear-gradient(135deg, #fffbeb 0%, #ffffff 42%);
    border-color: rgba(15, 23, 42, 0.10);
    border-left-color: #d97706;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.05);
  }
  html[data-ds-theme-source="light"] .dnb-strip-bar,
  html[data-ds-theme-source="light"] .dnb-vault-banner {
    background: linear-gradient(135deg, #f8fafc 0%, #ffffff 50%);
    border-color: rgba(15, 23, 42, 0.10);
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  }
  .dnb-token-track {
    width: 100%;
    height: 4px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.16);
    overflow: hidden;
  }
  .dnb-token-fill {
    height: 100%;
    border-radius: 999px;
    background: #34d399;
    transition: width 0.25s ease;
  }
  .dnb-token-fill[data-warn="high"] {
    background: #f59e0b;
  }
  .dnb-token-fill[data-warn="crit"] {
    background: #ef4444;
  }

  .dnb-vault-banner {
    padding: 7px 10px;
    border-radius: 9px;
    font-size: 11px;
    line-height: 1.45;
    margin-bottom: 8px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-card);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dnb-drawer-hdr {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 7px 10px;
    cursor: pointer;
    user-select: none;
    font-size: 12px;
    font-weight: 600;
    gap: 6px;
  }
  .dnb-drawer-hdr:hover {
    background: var(--dnb-card-hover);
  }

  /* Top-Down Stacked Paper Dossiers ("一沓纸": neat stack -> slide-out title & hooks on hover -> unfold on click) */
  .dnb-paper-stack {
    display: flex;
    flex-direction: column;
    padding: 6px 2px 6px;
    position: relative;
  }
  .dnb-paper-dossier {
    position: relative;
    margin: 0;
    border-radius: 6px 12px 7px 7px;
    background: linear-gradient(180deg, rgba(46, 50, 62, 0.96) 0%, rgba(36, 40, 50, 0.98) 100%);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-top-color: rgba(255, 255, 255, 0.16);
    box-shadow:
      0 -1px 4px rgba(0, 0, 0, 0.22),
      0 3px 8px rgba(0, 0, 0, 0.26);
    transition:
      transform 0.24s cubic-bezier(0.22, 1, 0.36, 1),
      margin 0.24s cubic-bezier(0.22, 1, 0.36, 1),
      box-shadow 0.22s ease,
      border-color 0.2s ease,
      background 0.2s ease;
    cursor: pointer;
    overflow: visible;
  }
  .dnb-paper-stack > .dnb-paper-dossier[data-expanded="0"] + .dnb-paper-dossier[data-expanded="0"] {
    margin-top: -8px;
  }
  .dnb-paper-dossier::before {
    content: "";
    position: absolute;
    left: 0;
    top: 7px;
    bottom: 7px;
    width: 3px;
    border-radius: 0 99px 99px 0;
    background: var(--dnb-paper-rail, #38bdf8);
    opacity: 0.85;
  }
  .dnb-paper-dossier::after {
    content: "";
    position: absolute;
    top: 0;
    right: 0;
    width: 11px;
    height: 11px;
    background: linear-gradient(225deg, rgba(15, 23, 42, 0.42) 48%, rgba(255, 255, 255, 0.14) 50%, transparent 100%);
    border-bottom-left-radius: 4px;
    pointer-events: none;
  }
  .dnb-paper-dossier[data-expanded="0"]:hover,
  .dnb-paper-dossier[data-expanded="0"]:focus-within {
    transform: translateY(-6px) translateX(3px) rotate(-0.22deg);
    margin-top: 4px !important;
    margin-bottom: 12px;
    z-index: 9;
    border-color: rgba(148, 163, 184, 0.34);
    box-shadow:
      0 12px 24px rgba(0, 0, 0, 0.38),
      2px 4px 0 -1px rgba(255, 255, 255, 0.06);
  }
  .dnb-paper-dossier[data-expanded="1"] {
    transform: none;
    margin: 10px 0 !important;
    z-index: 10;
    cursor: default;
    border-color: rgba(56, 189, 248, 0.38);
    box-shadow: 0 10px 26px rgba(0, 0, 0, 0.32);
  }
  .dnb-paper-dossier[data-viewer="desktop"] { --dnb-paper-rail: #f59e0b; }
  .dnb-paper-dossier[data-viewer="lead"] { --dnb-paper-rail: #10b981; }
  .dnb-paper-dossier[data-viewer="chief-reading"] { --dnb-paper-rail: #a855f7; }
  .dnb-paper-dossier[data-viewer="chief"] { --dnb-paper-rail: #38bdf8; }
  .dnb-paper-dossier[data-viewer="hook"] { --dnb-paper-rail: #fb923c; }
  .dnb-paper-dossier[data-viewer="human"] { --dnb-paper-rail: #64748b; }

  html[data-ds-theme-source="light"] .dnb-paper-dossier,
  html[data-ds-theme="light"] .dnb-paper-dossier,
  [data-ds-theme-source="light"] .dnb-paper-dossier {
    background: linear-gradient(180deg, #fffefb 0%, #f8f5ec 100%);
    border-color: rgba(180, 165, 130, 0.28);
    border-top-color: #ffffff;
    box-shadow:
      0 -1px 3px rgba(60, 45, 15, 0.06),
      0 3px 8px rgba(60, 45, 15, 0.08);
  }
  html[data-ds-theme-source="light"] .dnb-paper-dossier::after,
  html[data-ds-theme="light"] .dnb-paper-dossier::after,
  [data-ds-theme-source="light"] .dnb-paper-dossier::after {
    background: linear-gradient(225deg, rgba(226, 232, 240, 0.85) 48%, rgba(180, 165, 130, 0.24) 50%, transparent 100%);
  }
  html[data-ds-theme-source="light"] .dnb-paper-dossier[data-expanded="0"]:hover,
  html[data-ds-theme="light"] .dnb-paper-dossier[data-expanded="0"]:hover,
  [data-ds-theme-source="light"] .dnb-paper-dossier[data-expanded="0"]:hover,
  html[data-ds-theme-source="light"] .dnb-paper-dossier[data-expanded="0"]:focus-within,
  html[data-ds-theme="light"] .dnb-paper-dossier[data-expanded="0"]:focus-within,
  [data-ds-theme-source="light"] .dnb-paper-dossier[data-expanded="0"]:focus-within {
    box-shadow: 0 10px 22px rgba(60, 45, 15, 0.14);
  }
  @media (prefers-color-scheme: light) {
    html:not([data-ds-theme-source="dark"]):not([data-ds-theme="dark"]) .dnb-paper-dossier {
      background: linear-gradient(180deg, #fffefb 0%, #f8f5ec 100%);
      border-color: rgba(180, 165, 130, 0.28);
      border-top-color: #ffffff;
      box-shadow:
        0 -1px 3px rgba(60, 45, 15, 0.06),
        0 3px 8px rgba(60, 45, 15, 0.08);
    }
    html:not([data-ds-theme-source="dark"]):not([data-ds-theme="dark"]) .dnb-paper-dossier::after {
      background: linear-gradient(225deg, rgba(226, 232, 240, 0.85) 48%, rgba(180, 165, 130, 0.24) 50%, transparent 100%);
    }
    html:not([data-ds-theme-source="dark"]):not([data-ds-theme="dark"]) .dnb-paper-dossier[data-expanded="0"]:hover,
    html:not([data-ds-theme-source="dark"]):not([data-ds-theme="dark"]) .dnb-paper-dossier[data-expanded="0"]:focus-within {
      box-shadow: 0 10px 22px rgba(60, 45, 15, 0.14);
    }
  }
  .dnb-paper-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding-right: 10px;
  }
  .dnb-paper-title {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.38;
    color: var(--dnb-text, #f1f5f9);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dnb-paper-dossier[data-expanded="0"]:hover .dnb-paper-title,
  .dnb-paper-dossier[data-expanded="1"] .dnb-paper-title {
    white-space: normal;
    overflow: visible;
    text-overflow: unset;
  }
  .dnb-paper-peek {
    display: grid;
    grid-template-rows: 0fr;
    opacity: 0;
    transition: grid-template-rows 0.22s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.18s ease;
  }
  .dnb-paper-peek > div {
    overflow: hidden;
    min-height: 0;
  }
  .dnb-paper-dossier:hover .dnb-paper-peek,
  .dnb-paper-dossier:focus-within .dnb-paper-peek,
  .dnb-paper-dossier[data-expanded="1"] .dnb-paper-peek {
    grid-template-rows: 1fr;
    opacity: 1;
  }
  .dnb-hook-strip {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 4px;
    padding-top: 6px;
  }
  .dnb-hook-chip {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 500;
    background: rgba(148, 163, 184, 0.12);
    color: var(--dnb-text-2);
    border: 1px solid rgba(148, 163, 184, 0.22);
  }
  .dnb-viewer-badge {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 5px;
    border-radius: 999px;
    font-size: 10px;
    font-weight: 500;
    white-space: nowrap;
    flex-shrink: 0;
    color: var(--dnb-text-3);
    background: transparent;
  }
  .dnb-viewer-badge::before {
    content: "";
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: currentColor;
  }
  .dnb-viewer-badge[data-viewer="desktop"] { color: #f59e0b; }
  .dnb-viewer-badge[data-viewer="lead"] { color: #10b981; }
  .dnb-viewer-badge[data-viewer="chief-reading"] { color: #a855f7; }
  .dnb-viewer-badge[data-viewer="chief"] { color: #38bdf8; }
  .dnb-viewer-badge[data-viewer="human"] { color: #94a3b8; }
  .dnb-viewer-badge[data-viewer="hook"] { color: #fb923c; }

  .dnb-effort-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 3px;
  }
  .dnb-effort-btn {
    border: 1px solid var(--dnb-border);
    background: transparent;
    color: var(--dnb-text-3);
    border-radius: 6px;
    font-size: 10.5px;
    font-weight: 500;
    padding: 2px 7px;
    cursor: pointer;
    transition: background 0.14s ease, color 0.14s ease, border-color 0.14s ease;
  }
  .dnb-effort-btn[data-active="1"] {
    background: rgba(99, 102, 241, 0.16);
    color: #a5b4fc;
    border-color: rgba(129, 140, 248, 0.45);
    font-weight: 600;
  }
  .dnb-chat-effort-badge {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 9.5px;
    font-weight: 600;
    background: rgba(99, 102, 241, 0.12);
    color: #a5b4fc;
  }
  @keyframes dnb-obj-flash-red {
    0%, 100% {
      border-color: rgba(255, 69, 58, 0.92);
      box-shadow: 0 0 0 0 rgba(255, 69, 58, 0.42);
      transform: translateX(0);
    }
    20%, 60% {
      border-color: #ff453a;
      box-shadow: 0 0 0 4px rgba(255, 69, 58, 0.34);
      background: rgba(255, 69, 58, 0.14);
      transform: translateX(-3px);
    }
    40%, 80% {
      border-color: #ff6961;
      box-shadow: 0 0 0 2px rgba(255, 69, 58, 0.22);
      background: rgba(255, 69, 58, 0.08);
      transform: translateX(3px);
    }
  }
  .dnb-obj-flash-red {
    animation: dnb-obj-flash-red 0.72s ease-in-out 2;
  }

`
