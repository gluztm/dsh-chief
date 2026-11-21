/**
 * src/client/styles/tasks-pyramid.js — 任务金字塔树、竖脊线与可选 SVG 缩放画布样式
 *
 * 【核心职责】
 *   承载全宽零拖拽任务金字塔树、Tier 2+ 竖向连接脊线、任务卡内联状态药丸、
 *   全景 DAG 缩放画布（`.dnb-canvas-wrap`），以及目标状态徽章与焦点横幅样式。
 *
 * 【边界约定】
 *   - 仅服务于任务页签中的金字塔/全景画布视图；顺序工作流拓扑与组织树见 `styles/tasks-flow.js`。
 */

export const CSS_TASKS_PYRAMID = `
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

`
