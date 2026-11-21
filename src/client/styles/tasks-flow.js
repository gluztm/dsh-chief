/**
 * src/client/styles/tasks-flow.js — 顺序工作流拓扑、组织展开树与任务板亮色适配样式
 *
 * 【核心职责】
 *   承载 v1.6.0 顺序工作流管道拓扑（Steps ①→⑤、分支连线与交卷回流箭头）、浅色主题适配、
 *   可展开 Attention-First 组织树、里程碑进度圆点、已完成折叠组与兼容任务板助手样式。
 *
 * 【边界约定】
 *   - 紧跟 `styles/tasks-pyramid.js` 与全局样式加载，负责流程拓扑与新版任务板样式。
 */

export const CSS_TASKS_FLOW = `
  /* Sequential Workflow Pipeline Topology (v1.6.0) */
  .dnb-flow-root {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .dnb-flow-rail {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    flex-wrap: wrap;
    padding: 8px 10px;
    border-radius: 11px;
    background: var(--dnb-card);
    border: 1px solid var(--dnb-border);
  }
  .dnb-flow-miles {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-wrap: wrap;
  }
  .dnb-flow-mile {
    width: 21px;
    height: 21px;
    border-radius: 999px;
    border: 1.5px solid rgba(148, 163, 184, 0.45);
    background: rgba(148, 163, 184, 0.14);
    color: var(--dnb-text-2);
    font-size: 10.5px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    transition: transform 0.14s ease, border-color 0.16s ease, background 0.16s ease;
  }
  .dnb-flow-mile:hover { transform: scale(1.08); }
  .dnb-flow-mile[data-status="done"] {
    background: #16a34a;
    border-color: #16a34a;
    color: #ffffff;
  }
  .dnb-flow-mile[data-status="doing"] {
    background: rgba(59, 130, 246, 0.22);
    border-color: #3b82f6;
    color: #93c5fd;
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.2);
  }
  .dnb-flow-mile[data-status="blocked"] {
    background: rgba(239, 68, 68, 0.22);
    border-color: #ef4444;
    color: #fca5a5;
  }
  .dnb-flow-rail-link {
    width: 10px;
    height: 2px;
    border-radius: 2px;
    background: rgba(148, 163, 184, 0.35);
    display: inline-block;
  }
  .dnb-flow-rail-link[data-done="1"] {
    background: #22c55e;
  }
  .dnb-flow-rail-meta {
    font-size: 11px;
    color: var(--dnb-text-2);
    font-weight: 500;
  }
  .dnb-flow-pipeline {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .dnb-flow-stage {
    position: relative;
    border-radius: 12px;
    border: 1.5px solid var(--dnb-border);
    border-left: 4px solid rgba(148, 163, 184, 0.62);
    background: var(--dnb-card);
    padding: 10px 11px;
    transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
  }
  .dnb-flow-stage[data-status="done"] {
    border-color: rgba(34, 197, 94, 0.38);
    border-left-color: #22c55e;
    background: linear-gradient(90deg, rgba(34, 197, 94, 0.11) 0%, rgba(34, 197, 94, 0.04) 48%, var(--dnb-card) 100%);
  }
  .dnb-flow-stage[data-status="doing"] {
    border-color: rgba(56, 189, 248, 0.56);
    border-left-color: #38bdf8;
    background: linear-gradient(90deg, rgba(56, 189, 248, 0.14) 0%, rgba(59, 130, 246, 0.05) 54%, var(--dnb-card) 100%);
    box-shadow: 0 2px 12px rgba(37, 99, 235, 0.14);
  }
  .dnb-flow-stage[data-status="blocked"] {
    border-color: rgba(239, 68, 68, 0.56);
    border-left-color: #ef4444;
    background: linear-gradient(90deg, rgba(239, 68, 68, 0.14) 0%, rgba(239, 68, 68, 0.04) 54%, var(--dnb-card) 100%);
  }
  .dnb-flow-stage-head {
    display: flex;
    align-items: flex-start;
    gap: 8px;
  }
  .dnb-flow-step-num {
    width: 24px;
    height: 24px;
    border-radius: 999px;
    border: 1.6px solid rgba(148, 163, 184, 0.52);
    background: rgba(148, 163, 184, 0.12);
    color: var(--dnb-text-2);
    font-size: 11.5px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    margin-top: 1px;
    padding: 0;
    cursor: pointer;
    transition: transform 0.14s ease, background 0.16s ease, border-color 0.16s ease;
  }
  .dnb-flow-step-num:hover:not(:disabled) { transform: scale(1.07); }
  .dnb-flow-step-num:disabled { cursor: default; opacity: 0.85; }
  .dnb-flow-step-num[data-status="done"] {
    background: #16a34a;
    border-color: #16a34a;
    color: #ffffff;
  }
  .dnb-flow-step-num[data-status="doing"] {
    background: rgba(59, 130, 246, 0.22);
    border-color: #3b82f6;
    color: #93c5fd;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.16);
  }
  .dnb-flow-step-num[data-status="blocked"] {
    background: rgba(239, 68, 68, 0.22);
    border-color: #ef4444;
    color: #fca5a5;
  }
  .dnb-flow-stage-main {
    flex: 1 1 auto;
    min-width: 0;
  }
  .dnb-flow-stage-top {
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
    margin-bottom: 3px;
  }
  .dnb-flow-step-kicker {
    font-size: 10.5px;
    font-weight: 700;
    color: var(--dnb-text);
    padding: 1px 6px;
    border-radius: 999px;
    background: rgba(148, 163, 184, 0.14);
  }
  .dnb-flow-status-pill {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 1px 6px;
    border-radius: 999px;
    font-size: 10.5px;
    font-weight: 600;
    background: rgba(148, 163, 184, 0.16);
    color: var(--dnb-text-2);
  }
  .dnb-flow-status-pill[data-status="done"] {
    background: rgba(34, 197, 94, 0.18);
    color: #4ade80;
  }
  .dnb-flow-status-pill[data-status="doing"] {
    background: rgba(59, 130, 246, 0.2);
    color: #93c5fd;
  }
  .dnb-flow-status-pill[data-status="blocked"] {
    background: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }
  .dnb-flow-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .dnb-flow-count-chip {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 7px;
    border-radius: 999px;
    background: var(--dnb-fill);
    border: 1px solid rgba(148, 163, 184, 0.18);
    color: var(--dnb-text-2);
  }
  .dnb-flow-count-chip[data-kind="agents"] {
    background: rgba(56, 189, 248, 0.14);
    border-color: rgba(56, 189, 248, 0.34);
    color: #7dd3fc;
  }
  .dnb-flow-count-chip[data-kind="tasks"] {
    background: rgba(148, 163, 184, 0.12);
    color: var(--dnb-text);
  }
  .dnb-flow-stage-title {
    font-size: 13px;
    font-weight: 600;
    color: var(--dnb-text);
    line-height: 1.42;
    word-break: break-word;
  }
  .dnb-flow-stage[data-status="done"] .dnb-flow-stage-title {
    color: var(--dnb-text);
  }
  .dnb-flow-stage-summary {
    font-size: 11px;
    color: #4ade80;
    margin-top: 2px;
    line-height: 1.35;
    word-break: break-word;
  }
  .dnb-flow-stage[data-compact="1"] {
    padding: 8px 10px;
  }
  .dnb-flow-stage-ops {
    display: flex;
    align-items: center;
    gap: 3px;
    flex-shrink: 0;
    opacity: 0.88;
    transition: opacity 0.14s ease;
  }
  .dnb-flow-stage:hover .dnb-flow-stage-ops,
  .dnb-flow-stage:focus-within .dnb-flow-stage-ops {
    opacity: 1;
  }
  .dnb-flow-step-text-btn {
    height: 20px;
    padding: 0 6px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-2);
    font-size: 10.5px;
    font-weight: 500;
    cursor: pointer;
    line-height: 18px;
  }
  .dnb-flow-step-text-btn:hover {
    background: var(--dnb-fill);
    border-color: var(--dnb-border);
    color: var(--dnb-text);
  }
  .dnb-flow-step-text-btn[data-active="1"] {
    background: rgba(59, 130, 246, 0.16);
    border-color: rgba(59, 130, 246, 0.36);
    color: #60a5fa;
  }
  .dnb-flow-mini-btn {
    width: 22px;
    height: 22px;
    border-radius: 6px;
    border: 1px solid transparent;
    background: transparent;
    color: var(--dnb-text-2);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
  }
  .dnb-flow-mini-btn:hover {
    background: var(--dnb-fill);
    color: var(--dnb-text);
    border-color: var(--dnb-border);
  }
  .dnb-flow-mini-btn[data-active="1"] {
    background: rgba(59, 130, 246, 0.18);
    color: #60a5fa;
    border-color: rgba(59, 130, 246, 0.36);
  }
  .dnb-flow-inline-add {
    display: flex;
    gap: 5px;
    align-items: center;
    flex-wrap: wrap;
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--dnb-border);
  }
  .dnb-flow-stage-body {
    margin-top: 8px;
    padding-top: 8px;
    border-top: 1px dashed var(--dnb-border);
    display: flex;
    flex-direction: column;
    gap: 7px;
  }
  .dnb-flow-branches {
    display: flex;
    flex-direction: column;
    gap: 7px;
    padding-left: 10px;
    border-left: 2px solid rgba(148, 163, 184, 0.28);
  }
  .dnb-flow-branch-node {
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .dnb-flow-sub-indent {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding-left: 10px;
    border-left: 1.5px dashed rgba(148, 163, 184, 0.34);
  }
  .dnb-flow-agent-card {
    border-radius: 10px;
    border: 1px solid var(--dnb-border);
    background: var(--dnb-elevated);
    padding: 7px 9px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  .dnb-flow-agent-card[data-status="done"] {
    border-color: rgba(34, 197, 94, 0.44);
    background: rgba(34, 197, 94, 0.08);
  }
  .dnb-flow-agent-card[data-status="doing"] {
    border-color: rgba(59, 130, 246, 0.48);
    background: rgba(59, 130, 246, 0.08);
  }
  .dnb-flow-agent-card[data-status="blocked"] {
    border-color: rgba(239, 68, 68, 0.5);
    background: rgba(239, 68, 68, 0.09);
  }
  .dnb-flow-agent-card[data-focused="1"] {
    box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.45);
  }
  .dnb-flow-agent-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
  }
  .dnb-flow-agent-id {
    display: flex;
    align-items: center;
    gap: 5px;
    min-width: 0;
    flex-wrap: wrap;
    color: var(--dnb-text);
  }
  .dnb-flow-agent-name {
    font-size: 11.5px;
    font-weight: 600;
    color: var(--dnb-text);
    word-break: break-all;
  }
  .dnb-flow-agent-tools {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }
  .dnb-flow-agent-tasks {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dnb-flow-return-badge {
    width: 100%;
    text-align: left;
    border-radius: 7px;
    border: 1px dashed rgba(148, 163, 184, 0.35);
    background: rgba(148, 163, 184, 0.08);
    color: var(--dnb-text-2);
    font-size: 10.5px;
    font-weight: 600;
    padding: 4px 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    cursor: pointer;
    transition: background 0.14s ease, border-color 0.14s ease;
  }
  .dnb-flow-return-badge:hover {
    border-color: var(--dnb-border-strong);
  }
  .dnb-flow-return-badge[data-status="done"] {
    border-style: solid;
    border-color: rgba(34, 197, 94, 0.46);
    background: rgba(34, 197, 94, 0.16);
    color: #86efac;
  }
  .dnb-flow-return-badge[data-status="doing"] {
    border-color: rgba(59, 130, 246, 0.44);
    background: rgba(59, 130, 246, 0.14);
    color: #93c5fd;
  }
  .dnb-flow-return-badge[data-status="blocked"] {
    border-color: rgba(239, 68, 68, 0.46);
    background: rgba(239, 68, 68, 0.15);
    color: #fca5a5;
  }
  .dnb-flow-return-sub {
    font-size: 10px;
    opacity: 0.85;
    font-weight: 500;
  }
  .dnb-flow-lead-tasks {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dnb-flow-task-wrap {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .dnb-flow-task-row {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    padding: 7px 9px;
    border-radius: 9px;
    border: 1px solid rgba(148, 163, 184, 0.20);
    background: var(--dnb-elevated);
    cursor: pointer;
    transition: background 0.14s ease, border-color 0.14s ease;
  }
  .dnb-flow-task-row:hover {
    background: var(--dnb-card-hover);
  }
  .dnb-flow-task-row[data-selected="1"] {
    border-color: rgba(59, 130, 246, 0.55);
    background: var(--dnb-card-hover);
  }
  .dnb-flow-task-row[data-status="done"] {
    border-color: rgba(34, 197, 94, 0.30);
  }
  .dnb-flow-task-row[data-status="blocked"] {
    border-color: rgba(239, 68, 68, 0.42);
  }
  .dnb-flow-task-title {
    font-size: 12px;
    font-weight: 500;
    color: var(--dnb-text);
    line-height: 1.38;
    word-break: break-word;
    display: flex;
    align-items: center;
    gap: 5px;
    flex-wrap: wrap;
  }
  .dnb-flow-task-title[data-done="1"] {
    color: var(--dnb-text);
    opacity: 0.90;
    text-decoration: none;
  }
  .dnb-flow-xstep-pill {
    font-size: 10px;
    padding: 0 5px;
    border-radius: 999px;
    background: rgba(59, 130, 246, 0.16);
    color: #93c5fd;
    text-decoration: none;
  }
  .dnb-flow-task-ev {
    font-size: 10.5px;
    color: #4ade80;
    margin-top: 1px;
  }
  .dnb-flow-task-sub {
    font-size: 10.5px;
    color: var(--dnb-text-2);
    margin-top: 1px;
  }
  .dnb-flow-task-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex-shrink: 0;
    opacity: 0.62;
    transition: opacity 0.14s ease;
  }
  .dnb-flow-task-row:hover .dnb-flow-task-actions,
  .dnb-flow-task-row[data-selected="1"] .dnb-flow-task-actions,
  .dnb-flow-task-row:focus-within .dnb-flow-task-actions {
    opacity: 1;
  }
  .dnb-flow-connector {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 1px 0;
    color: rgba(148, 163, 184, 0.55);
  }
  .dnb-flow-connector[data-done="1"] {
    color: #22c55e;
  }
  .dnb-flow-connector[data-doing="1"] {
    color: #3b82f6;
  }
  .dnb-flow-conn-tag {
    font-size: 10px;
    font-weight: 600;
    color: #22c55e;
  }
  .dnb-flow-add-step {
    display: flex;
    align-items: center;
    gap: 6px;
    margin-top: 2px;
  }

  /* Light Theme overrides for Workflow Pipeline Topology & Task Board */
  html[data-ds-theme-source="light"] .dnb-text-filter-btn[data-active="1"],
  html[data-ds-theme="light"] .dnb-text-filter-btn[data-active="1"],
  [data-ds-theme-source="light"] .dnb-text-filter-btn[data-active="1"],
  [data-ds-theme="light"] .dnb-text-filter-btn[data-active="1"] {
    background: #ecfeff;
    border-color: rgba(8, 145, 178, 0.45);
    color: #0e7490;
  }
  html[data-ds-theme-source="light"] .dnb-flow-step-kicker,
  html[data-ds-theme="light"] .dnb-flow-step-kicker,
  [data-ds-theme-source="light"] .dnb-flow-step-kicker,
  [data-ds-theme="light"] .dnb-flow-step-kicker {
    background: #f1f5f9;
    border-color: #cbd5e1;
    color: #334155;
  }
  html[data-ds-theme-source="light"] .dnb-flow-count-chip[data-kind="agents"],
  html[data-ds-theme="light"] .dnb-flow-count-chip[data-kind="agents"],
  [data-ds-theme-source="light"] .dnb-flow-count-chip[data-kind="agents"],
  [data-ds-theme="light"] .dnb-flow-count-chip[data-kind="agents"] {
    background: #eff6ff;
    border-color: rgba(37, 99, 235, 0.28);
    color: #1d4ed8;
  }
  html[data-ds-theme-source="light"] .dnb-flow-count-chip[data-kind="tasks"],
  html[data-ds-theme="light"] .dnb-flow-count-chip[data-kind="tasks"],
  [data-ds-theme-source="light"] .dnb-flow-count-chip[data-kind="tasks"],
  [data-ds-theme="light"] .dnb-flow-count-chip[data-kind="tasks"] {
    background: #f5f3ff;
    border-color: rgba(124, 58, 237, 0.28);
    color: #6d28d9;
  }
  html[data-ds-theme-source="light"] .dnb-flow-task-row,
  html[data-ds-theme="light"] .dnb-flow-task-row,
  [data-ds-theme-source="light"] .dnb-flow-task-row,
  [data-ds-theme="light"] .dnb-flow-task-row {
    background: rgba(255, 255, 255, 0.85);
    border-color: rgba(15, 23, 42, 0.10);
  }
  html[data-ds-theme-source="light"] .dnb-flow-task-row:hover,
  html[data-ds-theme="light"] .dnb-flow-task-row:hover,
  [data-ds-theme-source="light"] .dnb-flow-task-row:hover,
  [data-ds-theme="light"] .dnb-flow-task-row:hover {
    background: #ffffff;
    border-color: rgba(15, 23, 42, 0.18);
  }
  html[data-ds-theme-source="light"] .dnb-flow-stage,
  html[data-ds-theme="light"] .dnb-flow-stage,
  [data-ds-theme-source="light"] .dnb-flow-stage {
    background: #ffffff;
  }
  html[data-ds-theme-source="light"] .dnb-flow-stage[data-status="done"],
  html[data-ds-theme="light"] .dnb-flow-stage[data-status="done"],
  [data-ds-theme-source="light"] .dnb-flow-stage[data-status="done"] {
    background: linear-gradient(90deg, #dcfce7 0%, #f0fdf4 28%, #ffffff 100%);
    border-color: rgba(22, 163, 74, 0.42);
    border-left-color: #16a34a;
  }
  html[data-ds-theme-source="light"] .dnb-flow-stage[data-status="doing"],
  html[data-ds-theme="light"] .dnb-flow-stage[data-status="doing"],
  [data-ds-theme-source="light"] .dnb-flow-stage[data-status="doing"] {
    background: linear-gradient(90deg, #dbeafe 0%, #eff6ff 28%, #ffffff 100%);
    border-color: rgba(37, 99, 235, 0.46);
    border-left-color: #2563eb;
  }
  html[data-ds-theme-source="light"] .dnb-flow-stage[data-status="blocked"],
  html[data-ds-theme="light"] .dnb-flow-stage[data-status="blocked"],
  [data-ds-theme-source="light"] .dnb-flow-stage[data-status="blocked"] {
    background: linear-gradient(90deg, #fee2e2 0%, #fef2f2 28%, #ffffff 100%);
    border-color: rgba(220, 38, 38, 0.46);
    border-left-color: #dc2626;
  }
  html[data-ds-theme-source="light"] .dnb-flow-mile[data-status="doing"],
  html[data-ds-theme="light"] .dnb-flow-mile[data-status="doing"],
  html[data-ds-theme-source="light"] .dnb-flow-step-num[data-status="doing"],
  html[data-ds-theme="light"] .dnb-flow-step-num[data-status="doing"] {
    color: #1d4ed8;
    background: #dbeafe;
  }
  html[data-ds-theme-source="light"] .dnb-flow-mile[data-status="blocked"],
  html[data-ds-theme="light"] .dnb-flow-mile[data-status="blocked"],
  html[data-ds-theme-source="light"] .dnb-flow-step-num[data-status="blocked"],
  html[data-ds-theme="light"] .dnb-flow-step-num[data-status="blocked"] {
    color: #b91c1c;
    background: #fee2e2;
  }
  html[data-ds-theme-source="light"] .dnb-flow-status-pill[data-status="done"],
  html[data-ds-theme="light"] .dnb-flow-status-pill[data-status="done"],
  html[data-ds-theme-source="light"] .dnb-flow-return-badge[data-status="done"],
  html[data-ds-theme="light"] .dnb-flow-return-badge[data-status="done"],
  html[data-ds-theme-source="light"] .dnb-flow-stage-summary,
  html[data-ds-theme="light"] .dnb-flow-stage-summary,
  html[data-ds-theme-source="light"] .dnb-flow-task-ev,
  html[data-ds-theme="light"] .dnb-flow-task-ev,
  html[data-ds-theme-source="light"] .dnb-flow-conn-tag,
  html[data-ds-theme="light"] .dnb-flow-conn-tag {
    color: #15803d;
  }
  html[data-ds-theme-source="light"] .dnb-flow-return-badge[data-status="done"],
  html[data-ds-theme="light"] .dnb-flow-return-badge[data-status="done"] {
    background: #dcfce7;
    border-color: rgba(22, 163, 74, 0.42);
  }
  html[data-ds-theme-source="light"] .dnb-flow-status-pill[data-status="doing"],
  html[data-ds-theme="light"] .dnb-flow-status-pill[data-status="doing"],
  html[data-ds-theme-source="light"] .dnb-flow-return-badge[data-status="doing"],
  html[data-ds-theme="light"] .dnb-flow-return-badge[data-status="doing"],
  html[data-ds-theme-source="light"] .dnb-flow-xstep-pill,
  html[data-ds-theme="light"] .dnb-flow-xstep-pill {
    color: #1d4ed8;
  }
  html[data-ds-theme-source="light"] .dnb-flow-status-pill[data-status="blocked"],
  html[data-ds-theme="light"] .dnb-flow-status-pill[data-status="blocked"],
  html[data-ds-theme-source="light"] .dnb-flow-return-badge[data-status="blocked"],
  html[data-ds-theme="light"] .dnb-flow-return-badge[data-status="blocked"] {
    color: #b91c1c;
  }
  html[data-ds-theme-source="light"] .dnb-flow-agent-card,
  html[data-ds-theme="light"] .dnb-flow-agent-card {
    background: #ffffff;
  }
  html[data-ds-theme-source="light"] .dnb-flow-agent-card[data-status="done"],
  html[data-ds-theme="light"] .dnb-flow-agent-card[data-status="done"] {
    background: #f0fdf4;
  }
  html[data-ds-theme-source="light"] .dnb-flow-agent-card[data-status="doing"],
  html[data-ds-theme="light"] .dnb-flow-agent-card[data-status="doing"] {
    background: #eff6ff;
  }
  html[data-ds-theme-source="light"] .dnb-flow-agent-card[data-status="blocked"],
  html[data-ds-theme="light"] .dnb-flow-agent-card[data-status="blocked"] {
    background: #fef2f2;
  }

  /* Compact Expandable Organization Tree (collapsed by default, pull-open on click) */
  .dnb-topo-pyr-wrap .dnb-pyr-apex {
    border-radius: 10px;
    padding: 8px 10px;
    box-shadow: none;
  }
  .dnb-pyr-tree-list {
    position: relative;
    margin-left: 11px;
    padding-left: 13px;
    margin-top: 6px;
    border-left: 2px solid var(--dnb-border-strong, rgba(155, 155, 168, 0.45));
    display: flex;
    flex-direction: column;
    gap: 5px;
    min-width: 0;
  }
  .dnb-pyr-tree-list[data-tone="doing"],
  .dnb-pyr-tree-list[data-tone="live"] {
    border-left-color: rgba(10, 132, 255, 0.65);
  }
  .dnb-pyr-tree-list[data-tone="blocked"] {
    border-left-color: rgba(255, 69, 58, 0.68);
  }
  .dnb-pyr-tree-node {
    padding: 6px 9px;
    border-radius: 9px;
  }
  .dnb-pyr-tree-node .dnb-pyr-node-head {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
    cursor: pointer;
    user-select: none;
  }
  .dnb-pyr-node-title {
    flex: 1 1 auto;
    min-width: 0;
    font-size: 12px;
    font-weight: 500;
    color: var(--dnb-text);
    line-height: 1.38;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .dnb-pyr-node-title[data-done="1"] {
    color: var(--dnb-text-3);
    text-decoration: line-through;
  }
  .dnb-pyr-tree-node[data-open="1"] .dnb-pyr-node-title {
    white-space: normal;
    word-break: break-word;
  }
  .dnb-pyr-detail-pill {
    font-size: 10px;
    font-weight: 500;
    color: var(--dnb-text-3);
    padding: 1px 6px;
    border-radius: 99px;
    background: var(--dnb-fill);
    white-space: nowrap;
    flex-shrink: 0;
  }
  .dnb-pyr-tree-node:hover .dnb-pyr-detail-pill,
  .dnb-pyr-tree-node[data-open="1"] .dnb-pyr-detail-pill {
    color: var(--dnb-text-2);
  }
  .dnb-pyr-node-detail {
    margin-top: 7px;
    padding-top: 7px;
    border-top: 1px dashed var(--dnb-border);
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  /* Compact Milestone Progress Dots inside Visual Work Topology Header */
  .dnb-acc-mini-miles {
    display: inline-flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0;
  }
  .dnb-acc-mini-mile {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 1.5px solid var(--dnb-border-strong);
    background: var(--dnb-fill);
    color: var(--dnb-text-2);
    font-size: 10px;
    font-weight: 700;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 0;
    cursor: pointer;
    transition: transform 0.12s ease, box-shadow 0.12s ease;
  }
  .dnb-acc-mini-mile:hover { transform: scale(1.12); }
  .dnb-acc-mini-mile[data-status="done"] {
    background: #16a34a;
    border-color: #22c55e;
    color: #ffffff;
    box-shadow: 0 0 0 2px rgba(34, 197, 94, 0.18);
  }
  .dnb-acc-mini-mile[data-status="doing"] {
    background: rgba(59, 130, 246, 0.28);
    border-color: #60a5fa;
    color: #93c5fd;
    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.24);
  }
  .dnb-acc-mini-mile[data-status="blocked"] {
    background: rgba(239, 68, 68, 0.24);
    border-color: #f87171;
    color: #fca5a5;
    box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.20);
  }
  .dnb-acc-mini-mile[data-status="blocked"] {
    background: rgba(239, 68, 68, 0.22);
    border-color: #ef4444;
    color: #f87171;
  }
  .dnb-acc-mini-link {
    width: 10px;
    height: 2px;
    background: rgba(148, 163, 184, 0.35);
    border-radius: 2px;
  }
  .dnb-acc-mini-link[data-done="1"] {
    background: #22c55e;
  }

  /* Constrained Topology Viewport inside Drawer */
  .dnb-topo-canvas-wrap .dnb-canvas {
    min-height: 200px;
    max-height: 360px;
    border-radius: 10px;
  }
  .dnb-topo-pyr-wrap {
    max-height: 400px;
    overflow: auto;
    padding-right: 2px;
  }

  /* Done Subtasks Foldable Group inside Active Stages */
  .dnb-flow-done-fold {
    margin-top: 2px;
    padding-top: 5px;
    border-top: 1px dashed var(--dnb-border);
  }
  .dnb-flow-done-fold-btn {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 6px;
    padding: 4px 8px;
    border-radius: 7px;
    border: 1px solid rgba(34, 197, 94, 0.22);
    background: rgba(34, 197, 94, 0.06);
    color: var(--dnb-text-2);
    font-size: 11px;
    font-weight: 500;
    cursor: pointer;
    transition: background-color 0.14s ease, border-color 0.14s ease;
  }
  .dnb-flow-done-fold-btn:hover {
    background: rgba(34, 197, 94, 0.12);
    border-color: rgba(34, 197, 94, 0.36);
    color: var(--dnb-text);
  }
  .dnb-flow-done-fold-hint {
    font-size: 10.5px;
    color: var(--dnb-text-3);
  }

  /* Merged Task Board legacy fallback helpers */
  .dnb-topo-zone {
    display: flex;
    flex-direction: column;
  }
  .dnb-step-idx-tag {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    padding: 0 5px;
    margin-right: 6px;
    border-radius: 5px;
    background: var(--dnb-fill);
    color: var(--dnb-text-2);
    vertical-align: 1px;
  }
  .dnb-step-subtasks {
    margin: 0 8px 6px 24px;
    padding-left: 8px;
    border-left: 2px solid rgba(59, 130, 246, 0.32);
    border-radius: 0 0 8px 0;
    background: rgba(148, 163, 184, 0.04);
  }
  .dnb-step-subtasks .dnb-cell {
    border-top: 1px solid var(--dnb-border);
  }
  .dnb-step-subtasks .dnb-cell:first-child {
    border-top: none;
  }
  .dnb-orphan-tasks {
    border-top: 1px dashed var(--dnb-border);
  }
  .dnb-orphan-tasks-head {
    font-size: 10.5px;
    font-weight: 600;
    color: var(--dnb-text-3);
    padding: 6px 12px 2px;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card:not([data-tone]) {
    background: #ffffff;
  }
  html[data-ds-theme-source="light"] .dnb-fleet-card,
  html[data-ds-theme="light"] .dnb-fleet-card,
  [data-ds-theme-source="light"] .dnb-fleet-card,
  html[data-ds-theme-source="light"] .dnb-acc-card.dnb-fleet-card,
  html[data-ds-theme="light"] .dnb-acc-card.dnb-fleet-card,
  [data-ds-theme-source="light"] .dnb-acc-card.dnb-fleet-card {
    background: linear-gradient(135deg, #ecfeff 0%, #ffffff 42%);
    border-left-color: #0891b2;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card.dnb-fleet-card > .dnb-acc-head,
  html[data-ds-theme="light"] .dnb-acc-card.dnb-fleet-card > .dnb-acc-head,
  [data-ds-theme-source="light"] .dnb-acc-card.dnb-fleet-card > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(6, 182, 212, 0.14), rgba(6, 182, 212, 0.02) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card.dnb-obj-card,
  html[data-ds-theme="light"] .dnb-acc-card.dnb-obj-card,
  [data-ds-theme-source="light"] .dnb-acc-card.dnb-obj-card {
    background: linear-gradient(135deg, #eff6ff 0%, #ffffff 44%);
    border-left-color: #2563eb;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card.dnb-obj-card > .dnb-acc-head,
  html[data-ds-theme="light"] .dnb-acc-card.dnb-obj-card > .dnb-acc-head,
  [data-ds-theme-source="light"] .dnb-acc-card.dnb-obj-card > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(37, 99, 235, 0.13), rgba(37, 99, 235, 0.02) 58%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card.dnb-topo-card,
  html[data-ds-theme="light"] .dnb-acc-card.dnb-topo-card,
  [data-ds-theme-source="light"] .dnb-acc-card.dnb-topo-card {
    background: linear-gradient(135deg, #ecfdf5 0%, #ffffff 42%);
    border-left-color: #059669;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card.dnb-topo-card > .dnb-acc-head,
  html[data-ds-theme="light"] .dnb-acc-card.dnb-topo-card > .dnb-acc-head,
  [data-ds-theme-source="light"] .dnb-acc-card.dnb-topo-card > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(16, 185, 129, 0.13), rgba(16, 185, 129, 0.02) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card.dnb-board-card,
  html[data-ds-theme="light"] .dnb-acc-card.dnb-board-card,
  [data-ds-theme-source="light"] .dnb-acc-card.dnb-board-card {
    background: linear-gradient(135deg, #f5f3ff 0%, #ffffff 38%);
    border-left-color: #7c3aed;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card.dnb-board-card > .dnb-acc-head,
  html[data-ds-theme="light"] .dnb-acc-card.dnb-board-card > .dnb-acc-head,
  [data-ds-theme-source="light"] .dnb-acc-card.dnb-board-card > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(124, 58, 237, 0.13), rgba(124, 58, 237, 0.02) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-card.dnb-handoff-card,
  html[data-ds-theme="light"] .dnb-acc-card.dnb-handoff-card,
  [data-ds-theme-source="light"] .dnb-acc-card.dnb-handoff-card {
    background: linear-gradient(135deg, #fffbeb 0%, #ffffff 42%);
    border-left-color: #d97706;
  }
  html[data-ds-theme-source="light"] .dnb-acc-card.dnb-handoff-card > .dnb-acc-head,
  html[data-ds-theme="light"] .dnb-acc-card.dnb-handoff-card > .dnb-acc-head,
  [data-ds-theme-source="light"] .dnb-acc-card.dnb-handoff-card > .dnb-acc-head {
    background: linear-gradient(90deg, rgba(245, 158, 11, 0.14), rgba(245, 158, 11, 0.02) 55%, transparent);
  }
  html[data-ds-theme-source="light"] .dnb-acc-mini-mile[data-status="doing"],
  html[data-ds-theme="light"] .dnb-acc-mini-mile[data-status="doing"],
  [data-ds-theme-source="light"] .dnb-acc-mini-mile[data-status="doing"] {
    background: #dbeafe;
    border-color: #2563eb;
    color: #1d4ed8;
  }
  html[data-ds-theme-source="light"] .dnb-pyr-detail-pill,
  html[data-ds-theme="light"] .dnb-pyr-detail-pill,
  [data-ds-theme-source="light"] .dnb-pyr-detail-pill {
    background: rgba(15, 23, 42, 0.06);
  }
  html[data-ds-theme-source="light"] .dnb-acc-badge[data-tone="amber"],
  html[data-ds-theme="light"] .dnb-acc-badge[data-tone="amber"],
  [data-ds-theme-source="light"] .dnb-acc-badge[data-tone="amber"] {
    background: rgba(245, 158, 11, 0.14);
    color: #b45309;
  }
  html[data-ds-theme-source="light"] .dnb-acc-badge[data-tone="accent"],
  html[data-ds-theme="light"] .dnb-acc-badge[data-tone="accent"],
  [data-ds-theme-source="light"] .dnb-acc-badge[data-tone="accent"],
  html[data-ds-theme-source="light"] .dnb-acc-mini-mile[data-status="doing"],
  html[data-ds-theme="light"] .dnb-acc-mini-mile[data-status="doing"],
  [data-ds-theme-source="light"] .dnb-acc-mini-mile[data-status="doing"],
  html[data-ds-theme-source="light"] .dnb-flow-step-text-btn[data-active="1"],
  html[data-ds-theme="light"] .dnb-flow-step-text-btn[data-active="1"],
  [data-ds-theme-source="light"] .dnb-flow-step-text-btn[data-active="1"] {
    background: #dbeafe;
    color: #1d4ed8;
  }
  html[data-ds-theme-source="light"] .dnb-acc-mini-mile[data-status="blocked"],
  html[data-ds-theme="light"] .dnb-acc-mini-mile[data-status="blocked"],
  [data-ds-theme-source="light"] .dnb-acc-mini-mile[data-status="blocked"] {
    background: #fee2e2;
    color: #b91c1c;
  }
  html[data-ds-theme-source="light"] .dnb-flow-done-fold-btn,
  html[data-ds-theme="light"] .dnb-flow-done-fold-btn,
  [data-ds-theme-source="light"] .dnb-flow-done-fold-btn {
    background: #f0fdf4;
    border-color: rgba(22, 163, 74, 0.28);
    color: #166534;
  }
  html[data-ds-theme-source="light"] .dnb-flow-done-fold-btn:hover,
  html[data-ds-theme="light"] .dnb-flow-done-fold-btn:hover,
  [data-ds-theme-source="light"] .dnb-flow-done-fold-btn:hover {
    background: #dcfce7;
  }
  html[data-ds-theme-source="light"] .dnb-step-subtasks,
  html[data-ds-theme="light"] .dnb-step-subtasks,
  [data-ds-theme-source="light"] .dnb-step-subtasks {
    background: rgba(15, 23, 42, 0.025);
    border-left-color: rgba(37, 99, 235, 0.3);
  }

`
