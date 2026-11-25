/**
 * src/client/styles/v180.js — v1.8.0 专属视觉样式模块
 * （左上角动态亮黄 & gh 直连 Star 星标 · Linear×Obsidian×Apple 极简整页私有脑 + 神经星图 · 协同 2.0 实时流 · 边界安全模板）
 *
 * 【边界约定】
 *   - 独立专题样式模块，在 `styles.js` 的 `STYLE_SHEETS` 末尾注册，所有浅色主题覆写统一使用
 *     `html[data-ds-theme-source="light"] .xxx` 前缀以便 `expandLightThemeSelectors()` 自动多选择器展开。
 */

export const CSS_V180 = `
  /* =====================================================================
   * 1. Header Top-Left GitHub Star Button (Dynamic Yellow Burst + Real Count)
   * ===================================================================== */
  .dnb-star-btn {
    position: relative;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 3.5px;
    height: 23px;
    padding: 0 7px;
    border-radius: 999px;
    border: 1px solid rgba(148, 163, 184, 0.24);
    background: rgba(255, 255, 255, 0.04);
    color: var(--dnb-text-2);
    font: inherit;
    font-size: 10.5px;
    font-weight: 600;
    cursor: pointer;
    flex-shrink: 0;
    overflow: visible;
    text-decoration: none;
    transition: transform 0.16s cubic-bezier(0.22, 1, 0.36, 1), border-color 0.22s ease, background 0.22s ease, color 0.22s ease, box-shadow 0.24s ease;
  }
  .dnb-star-btn:hover,
  .dnb-star-btn:visited {
    text-decoration: none;
  }
  .dnb-star-btn:hover {
    transform: translateY(-0.5px) scale(1.04);
    border-color: rgba(250, 204, 21, 0.52);
    background: rgba(250, 204, 21, 0.12);
    color: #fde047;
    box-shadow: 0 0 10px rgba(250, 204, 21, 0.20);
  }
  .dnb-star-btn:active {
    transform: scale(0.91);
  }
  .dnb-star-btn[data-starred="1"] {
    border-color: rgba(250, 204, 21, 0.62);
    background: linear-gradient(135deg, rgba(250, 204, 21, 0.20) 0%, rgba(245, 158, 11, 0.12) 100%);
    color: #facc15;
    box-shadow: 0 0 12px rgba(250, 204, 21, 0.28), inset 0 0 8px rgba(254, 240, 138, 0.14);
  }
  .dnb-star-svg {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    transform-origin: center;
    transition: filter 0.25s ease, transform 0.25s ease;
  }
  .dnb-star-btn[data-starred="1"] .dnb-star-svg {
    color: #fde047;
    filter: drop-shadow(0 0 6px rgba(250, 204, 21, 0.85));
    animation: dnb-star-idle-gleam 3.2s ease-in-out infinite;
  }
  .dnb-star-btn[data-burst="1"] .dnb-star-svg {
    animation: dnb-star-pop 0.62s cubic-bezier(0.22, 1.4, 0.36, 1) forwards;
  }
  .dnb-star-label {
    font-size: 10px;
    letter-spacing: 0.1px;
    line-height: 1;
  }
  .dnb-star-count {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 9.5px;
    font-weight: 700;
    line-height: 1;
    padding: 1.5px 4.5px;
    border-radius: 99px;
    background: rgba(148, 163, 184, 0.18);
    color: inherit;
    opacity: 0.92;
  }
  .dnb-star-btn[data-starred="1"] .dnb-star-count {
    background: rgba(250, 204, 21, 0.22);
    color: #fef08a;
  }
  .dnb-star-ring {
    position: absolute;
    inset: -3px;
    border-radius: 999px;
    border: 1.5px solid rgba(250, 204, 21, 0.85);
    pointer-events: none;
    opacity: 0;
    animation: dnb-star-ring 0.68s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }
  .dnb-star-spark {
    position: absolute;
    left: 11px;
    top: 50%;
    width: 4px;
    height: 4px;
    margin: -2px 0 0 -2px;
    border-radius: 99px;
    background: #fef08a;
    box-shadow: 0 0 6px #facc15;
    pointer-events: none;
    opacity: 0;
    animation: dnb-star-ray 0.64s cubic-bezier(0.16, 1, 0.3, 1) forwards;
  }

  @keyframes dnb-star-pop {
    0%   { transform: scale(0.72) rotate(-18deg); filter: drop-shadow(0 0 2px rgba(250, 204, 21, 0.4)); }
    42%  { transform: scale(1.42) rotate(12deg);  filter: drop-shadow(0 0 12px rgba(253, 224, 71, 1)); }
    72%  { transform: scale(0.94) rotate(-6deg);  filter: drop-shadow(0 0 8px rgba(250, 204, 21, 0.9)); }
    100% { transform: scale(1) rotate(0deg);      filter: drop-shadow(0 0 6px rgba(250, 204, 21, 0.85)); }
  }
  @keyframes dnb-star-idle-gleam {
    0%, 100% { filter: drop-shadow(0 0 4px rgba(250, 204, 21, 0.55)); }
    50%      { filter: drop-shadow(0 0 8px rgba(253, 224, 71, 0.92)); }
  }
  @keyframes dnb-star-ring {
    0%   { opacity: 0.95; transform: scale(0.88); }
    100% { opacity: 0;    transform: scale(1.55); }
  }
  @keyframes dnb-star-ray {
    0%   { opacity: 1; transform: rotate(var(--ang, 0deg)) translateX(4px) scale(1); }
    70%  { opacity: 0.95; }
    100% { opacity: 0; transform: rotate(var(--ang, 0deg)) translateX(18px) scale(0.25); }
  }

  @container dnb-head (max-width: 410px) {
    .dnb-star-label { display: none; }
    .dnb-star-btn { padding: 0 5.5px; }
  }

  html[data-ds-theme-source="light"] .dnb-star-btn {
    background: #f8fafc;
    border-color: #cbd5e1;
    color: #475569;
  }
  html[data-ds-theme-source="light"] .dnb-star-btn:hover {
    background: #fef9c3;
    border-color: #eab308;
    color: #b45309;
    box-shadow: 0 2px 8px rgba(234, 179, 8, 0.24);
  }
  html[data-ds-theme-source="light"] .dnb-star-btn[data-starred="1"] {
    background: linear-gradient(135deg, #fef08a 0%, #fde047 100%);
    border-color: #eab308;
    color: #854d0e;
    box-shadow: 0 2px 10px rgba(234, 179, 8, 0.34);
  }
  html[data-ds-theme-source="light"] .dnb-star-btn[data-starred="1"] .dnb-star-svg {
    color: #ca8a04;
    filter: drop-shadow(0 0 4px rgba(234, 179, 8, 0.65));
  }
  html[data-ds-theme-source="light"] .dnb-star-btn[data-starred="1"] .dnb-star-count {
    background: rgba(161, 98, 7, 0.14);
    color: #713f12;
  }

  /* =====================================================================
   * 2. Collaboration 2.0: Live Output Stream & Chain Relay Bar
   * ===================================================================== */
  .dnb-stream-box {
    margin-top: 8px;
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    background: rgba(15, 23, 42, 0.56);
    overflow: hidden;
  }
  .dnb-stream-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 6px 10px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid var(--dnb-border);
    font-size: 11px;
    font-weight: 600;
    color: var(--dnb-text-2);
  }
  .dnb-stream-tabs {
    display: flex;
    gap: 4px;
    flex-wrap: wrap;
    padding: 6px 8px 0;
  }
  .dnb-stream-tab {
    border: 1px solid var(--dnb-border);
    background: transparent;
    color: var(--dnb-text-2);
    border-radius: 99px;
    padding: 2px 8px;
    font: inherit;
    font-size: 10.5px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .dnb-stream-tab[data-active="1"] {
    border-color: rgba(56, 189, 248, 0.52);
    background: rgba(56, 189, 248, 0.14);
    color: #38bdf8;
    font-weight: 600;
  }
  .dnb-stream-pre {
    margin: 0;
    padding: 8px 10px 10px;
    max-height: 148px;
    overflow-y: auto;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-size: 11px;
    line-height: 1.48;
    color: var(--dnb-text);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .dnb-chain-row {
    display: flex;
    align-items: center;
    gap: 6px;
    flex-wrap: wrap;
    width: 100%;
    padding-top: 5px;
    border-top: 1px dashed var(--dnb-border);
    font-size: 11px;
    color: var(--dnb-text-2);
  }

  html[data-ds-theme-source="light"] .dnb-stream-box {
    background: #f8fafc;
    border-color: #cbd5e1;
  }
  html[data-ds-theme-source="light"] .dnb-stream-head {
    background: #f1f5f9;
    border-bottom-color: #e2e8f0;
  }
  html[data-ds-theme-source="light"] .dnb-stream-tab[data-active="1"] {
    background: #eff6ff;
    border-color: rgba(37, 99, 235, 0.36);
    color: #1d4ed8;
  }

  /* =====================================================================
   * 4. Boundaries Guard-Wall Preset Pack & Import/Export Drawer
   * ===================================================================== */
  .dnb-tpl-drawer {
    padding: 9px 12px 11px;
    border-bottom: 1px solid var(--dnb-border);
    background: rgba(56, 189, 248, 0.04);
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dnb-tpl-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(195px, 1fr));
    gap: 7px;
  }
  .dnb-tpl-card {
    padding: 8px 9px;
    border-radius: 9px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-fill);
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dnb-tpl-title {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dnb-text);
  }
  .dnb-tpl-desc {
    font-size: 10.5px;
    line-height: 1.42;
    color: var(--dnb-text-3);
  }

  html[data-ds-theme-source="light"] .dnb-tpl-drawer {
    background: #f8fafc;
  }
  html[data-ds-theme-source="light"] .dnb-tpl-card {
    background: #ffffff;
    border-color: #cbd5e1;
  }

  @media (prefers-reduced-motion: reduce) {
    .dnb-star-btn[data-starred="1"] .dnb-star-svg,
    .dnb-star-btn[data-burst="1"] .dnb-star-svg,
    .dnb-star-ring,
    .dnb-star-spark {
      animation: none !important;
    }
  }
`
