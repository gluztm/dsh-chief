/**
 * src/client/styles/modals.js — 战术舱弹窗、目标审批、冷库检索与 v1.2.1 权限审批样式
 *
 * 【核心职责】
 *   承载 vNext 微扁平战术舱与作用域弹窗、目标审批/冷库弹窗、
 *   v1.2.1 四档权限选择卡片、命令拦截审批单、提权确认弹窗及风险确认弹窗样式。
 *
 * 【边界约定】
 *   - 仅包含弹窗与权限确认卡片相关样式，不含参谋输入流光动效与状态徽章（见 `styles/chief.js`）。
 */

export const CSS_MODALS = `
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
    background-color: #1f2024;
    background-image: linear-gradient(var(--dnb-popover), var(--dnb-popover));
    border: 1.5px solid rgba(96, 165, 250, 0.36);
    box-shadow: 0 14px 36px rgba(0, 0, 0, 0.38), 0 0 0 1px rgba(255, 255, 255, 0.06) inset;
    padding: 0;
    display: flex;
    flex-direction: column;
    max-height: min(82vh, 660px);
    overflow: hidden;
  }
  .dnb-tactical-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 10px 12px 7px;
    border-bottom: 1px solid var(--dnb-border);
    flex-shrink: 0;
  }
  .dnb-tactical-body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    padding: 6px 12px 10px;
    display: flex;
    flex-direction: column;
    gap: 8px;
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
    gap: 8px;
    margin-top: 2px;
  }
  .dnb-six-row {
    display: flex;
    align-items: baseline;
    gap: 12px;
    padding: 1px 0;
    border-radius: 0;
    border: none;
    background: transparent;
  }
  .dnb-six-tag {
    flex-shrink: 0;
    width: 64px;
    font-size: 11.5px;
    font-weight: 450;
    padding: 0;
    border-radius: 0;
    color: var(--dnb-text-3);
    background: transparent;
    line-height: 1.5;
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
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 3px;
    padding: 3px;
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-fill);
    margin-bottom: 10px;
  }
  .dnb-vault-seg-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 4px;
    min-height: 27px;
    padding: 3px 5px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-2);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }
  .dnb-vault-seg-btn:hover {
    color: var(--dnb-text);
    background: rgba(128, 128, 140, 0.08);
  }
  .dnb-vault-seg-btn[data-active="1"] {
    background: var(--dnb-elevated);
    border-color: var(--dnb-border-strong);
    color: var(--dnb-text);
    font-weight: 600;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.14);
  }
  .dnb-vault-seg-btn[data-active="1"]::after {
    content: "";
    position: absolute;
    left: 24%;
    right: 24%;
    bottom: 1.5px;
    height: 2px;
    border-radius: 99px;
    background: var(--dnb-vault-bar, var(--dnb-accent));
    opacity: 0.9;
  }
  .dnb-vault-seg-btn[data-active="1"][data-scope="desktop"] {
    --dnb-vault-bar: #f59e0b;
    background: linear-gradient(180deg, rgba(245, 158, 11, 0.14), rgba(245, 158, 11, 0.05));
    border-color: rgba(245, 158, 11, 0.34);
  }
  .dnb-vault-seg-btn[data-active="1"][data-scope="session"] {
    --dnb-vault-bar: #3b82f6;
    background: linear-gradient(180deg, rgba(59, 130, 246, 0.14), rgba(59, 130, 246, 0.05));
    border-color: rgba(59, 130, 246, 0.34);
  }
  .dnb-vault-seg-btn[data-active="1"][data-scope="global"] {
    --dnb-vault-bar: #10b981;
    background: linear-gradient(180deg, rgba(16, 185, 129, 0.14), rgba(16, 185, 129, 0.05));
    border-color: rgba(16, 185, 129, 0.34);
  }
  .dnb-vault-seg-btn[data-active="1"][data-scope="precipitated"] {
    --dnb-vault-bar: #06b6d4;
    background: linear-gradient(180deg, rgba(6, 182, 212, 0.14), rgba(6, 182, 212, 0.05));
    border-color: rgba(6, 182, 212, 0.34);
  }
  html[data-ds-theme-source="light"] .dnb-vault-seg {
    background: rgba(15, 23, 42, 0.055);
    border-color: rgba(15, 23, 42, 0.09);
  }
  html[data-ds-theme-source="light"] .dnb-vault-seg-btn {
    color: #475569;
  }
  html[data-ds-theme-source="light"] .dnb-vault-seg-btn:hover {
    color: #0f172a;
    background: rgba(255, 255, 255, 0.55);
  }
  html[data-ds-theme-source="light"] .dnb-vault-seg-btn[data-active="1"] {
    background: #ffffff;
    color: #0f172a;
    border-color: rgba(15, 23, 42, 0.12);
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  }
  html[data-ds-theme-source="light"] .dnb-vault-seg-btn[data-active="1"][data-scope="desktop"] {
    --dnb-vault-bar: #d97706;
    background: linear-gradient(180deg, #fffbeb 0%, #ffffff 100%);
    border-color: rgba(217, 119, 6, 0.30);
    color: #92400e;
  }
  html[data-ds-theme-source="light"] .dnb-vault-seg-btn[data-active="1"][data-scope="session"] {
    --dnb-vault-bar: #2563eb;
    background: linear-gradient(180deg, #eff6ff 0%, #ffffff 100%);
    border-color: rgba(37, 99, 235, 0.28);
    color: #1e40af;
  }
  html[data-ds-theme-source="light"] .dnb-vault-seg-btn[data-active="1"][data-scope="global"] {
    --dnb-vault-bar: #059669;
    background: linear-gradient(180deg, #ecfdf5 0%, #ffffff 100%);
    border-color: rgba(5, 150, 105, 0.28);
    color: #065f46;
  }
  html[data-ds-theme-source="light"] .dnb-vault-seg-btn[data-active="1"][data-scope="precipitated"] {
    --dnb-vault-bar: #0891b2;
    background: linear-gradient(180deg, #ecfeff 0%, #ffffff 100%);
    border-color: rgba(8, 145, 178, 0.28);
    color: #155e75;
  }
  .dnb-vault-seg-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 14px;
    height: 15px;
    padding: 0 4px;
    border-radius: 99px;
    font-size: 9.5px;
    font-weight: 600;
    background: transparent;
    color: var(--dnb-text-3);
  }
  .dnb-vault-seg-btn[data-active="1"] .dnb-vault-seg-badge {
    background: rgba(37, 99, 235, 0.12);
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
    background-color: #1f2024;
    background-image: linear-gradient(var(--dnb-popover), var(--dnb-popover));
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
    gap: 0;
    padding: 0;
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-qa-turn-box {
    border: none;
    border-bottom: 1px solid var(--dnb-border);
    background: transparent;
    border-radius: 0;
    padding: 10px 2px;
    box-shadow: none;
    transition: background-color 0.15s ease;
  }
  .dnb-qa-turn-box:last-child {
    border-bottom: none;
  }
  .dnb-qa-turn-box[data-turn-kind="system"] {
    border-color: var(--dnb-border);
    background: transparent;
    box-shadow: none;
  }
  .dnb-turn-question {
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 3px 6px 6px;
    border-radius: 8px;
    cursor: pointer;
    user-select: none;
    background: transparent;
    border-bottom: none;
    transition: background 0.14s ease;
  }
  .dnb-turn-question:hover {
    background: var(--dnb-fill);
  }
  .dnb-qa-turn-box[data-turn-kind="system"] .dnb-turn-question {
    background: transparent;
    border-bottom-color: transparent;
  }
  .dnb-qa-turn-box[data-turn-kind="system"] .dnb-turn-question:hover {
    background: var(--dnb-fill);
  }
  .dnb-qa-turn-box[data-collapsed="1"] .dnb-turn-question {
    padding-bottom: 3px;
  }
  .dnb-turn-replies {
    display: flex;
    flex-direction: column;
    gap: 4px;
    margin-left: 10px;
    padding: 2px 0 2px 13px;
    border-left: 1px solid var(--dnb-border-strong);
  }
  .dnb-turn-reply-item {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    padding: 4px 7px;
    border-radius: 9px;
    border: none;
    background: transparent;
    transition: background 0.14s ease;
  }
  .dnb-turn-reply-item:hover {
    background: var(--dnb-fill);
  }
  .dnb-turn-reply-item[data-role="receipt"] {
    border: none;
    background: transparent;
  }
  .dnb-turn-reply-item[data-role="receipt"]:hover {
    background: var(--dnb-fill);
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
    margin-bottom: 10px;
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    border-left: 3px solid rgba(239, 68, 68, 0.72);
    background: var(--dnb-card);
    overflow: visible;
  }
  .dnb-wall-item {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 8px 11px;
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-wall-actions-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 4px;
    width: 100%;
    margin-top: 1px;
  }
  .dnb-wall-scope-btn {
    height: 20px;
    padding: 0 7px;
    border-radius: 99px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-3);
    font-size: 10.5px;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.14s ease;
  }
  .dnb-wall-scope-btn:hover {
    color: var(--dnb-text-2);
    background: var(--dnb-fill);
  }
  .dnb-wall-scope-btn[data-active="1"] {
    border-color: rgba(248, 113, 113, 0.38);
    background: rgba(239, 68, 68, 0.12);
    color: #f87171;
    font-weight: 600;
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

`
