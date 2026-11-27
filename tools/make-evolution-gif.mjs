#!/usr/bin/env node
/**
 * make-evolution-gif.mjs — dsh-chief v1.0 -> v2.0 架构演进高清高帧率动态图生成器
 *
 * 输出中英双版 10 FPS (294 帧 / 29.4 秒循环) 单舞台极简动图：
 *   - assets/evolution-roadmap.gif     (zh, 880x495, 294 frames)
 *   - assets/evolution-roadmap-en.gif  (en, 880x495, 294 frames)
 *
 * 技术特性：
 *   - 单 Chrome CDP 实例 (Node 24 原生 WebSocket + fetch)，无外部依赖
 *   - Python Pillow 255 色全局自适应调色板 + C 级帧间透明差分 (disposal=1)
 *   - 内置逐帧解码校验 (n_frames==294, duration==29400ms, max_diff==0 零残影)
 *
 * 用法：
 *   node tools/make-evolution-gif.mjs
 *   node tools/make-evolution-gif.mjs --lang=zh
 *   node tools/make-evolution-gif.mjs --keep-samples=path/to/dir
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PYTHON = process.env.PYTHON_PATH ?? 'D:/Applications/Python312/python.exe'
const W = 880
const H = 495
const FPS_DELAY = 100
const MAX_BYTES = 1.5 * 1024 * 1024

const MILESTONES = {
  zh: [
    { ver: 'v1.0–1.1', label: '副驾' },
    { ver: 'v1.2–1.2.1', label: '造笼' },
    { ver: 'v1.3', label: '拆巨石' },
    { ver: 'v1.4', label: '物理墙' },
    { ver: 'v1.5–1.6', label: '认知桌' },
    { ver: 'v1.7', label: '主屏协同' },
    { ver: 'v1.8–1.9', label: '主题记忆' },
    { ver: 'v2.0', label: '语音传呼' },
  ],
  en: [
    { ver: 'v1.0–1.1', label: 'Co-Pilot' },
    { ver: 'v1.2–1.2.1', label: 'Cage' },
    { ver: 'v1.3', label: 'Modular' },
    { ver: 'v1.4', label: 'Pre-Exec' },
    { ver: 'v1.5–1.6', label: 'Desktop' },
    { ver: 'v1.7', label: 'Main Hub' },
    { ver: 'v1.8–1.9', label: 'Studio' },
    { ver: 'v2.0', label: 'Voice Hub' },
  ],
}

const SCENES = {
  zh: [
    {
      id: 1,
      frames: 34,
      chip: 'v1.0–1.1 · 8 文件',
      tone: 'info',
      title: 'v1.0–1.1 · 右侧记事本长成副驾',
      sub: '压缩前先存盘 · 四层冷档案平时 0 字节不烧 Token',
    },
    {
      id: 2,
      frames: 34,
      chip: 'v1.2–1.2.1 · 10 巨石!',
      tone: 'warn',
      title: 'v1.2–1.2.1 · 装上执行手，立刻造好笼子',
      sub: 'L0 默认只读 · 改前弹窗问 · 单文件却飙到 1.6 万行',
    },
    {
      id: 3,
      frames: 34,
      chip: 'v1.3 · 45 模块',
      tone: 'ok',
      title: 'v1.3 · 拆掉万行巨石，换上工程底座',
      sub: '29 后端 + 16 前端零破坏拆分 · 0 循环依赖 · 并发不丢锁',
    },
    {
      id: 4,
      frames: 34,
      chip: 'v1.4 · 54 模块',
      tone: 'ok',
      title: 'v1.4 · 执行前立物理墙，不抢主对话活',
      sub: '9 模块安全内核卡死 tools/pre-execute · L3 也拆不掉墙',
    },
    {
      id: 5,
      frames: 34,
      chip: 'v1.5–1.6 · 58 模块',
      tone: 'ok',
      title: 'v1.5–1.6 · 2400T 认知桌面 · 硬预算熔断',
      sub: '收口成 5 页签与流程画布 · 30 次 / 300K 到点自动停机',
    },
    {
      id: 6,
      frames: 34,
      chip: 'v1.7 · 83 模块',
      tone: 'ok',
      title: 'v1.7 · 主页面大屏 · 本机外协 · 按需启用',
      sub: '主屏外协直连 Codex / Claude · 普通闲聊窗 8 钩子全放行',
    },
    {
      id: 7,
      frames: 38,
      chip: 'v1.8–1.9 · 95 模块',
      tone: 'ok',
      title: 'v1.8–1.9 · DIY 主题与 0 字节参谋记忆工坊',
      sub: '5+1 自适应皮肤 · Bento 流光图 · Gemini CLI · 2D/3D 星图 + 外挂桥',
    },
    {
      id: 8,
      frames: 52,
      chip: 'v2.0 · 101 模块 · 0 依赖',
      tone: 'good',
      title: 'v2.0 · 语音参谋外放 · 6 通道传呼 · 三协议向量',
      sub: '音箱急报 + 唤醒发令 + BM25 / 双链回滚 · 53 后端 + 48 前端零外部依赖',
    },
  ],
  en: [
    {
      id: 1,
      frames: 34,
      chip: 'v1.0–1.1 · 8 files',
      tone: 'info',
      title: 'v1.0–1.1 · From Notepad to Co-Pilot',
      sub: 'Save paths before /compact · 4-tier cold vaults inject 0 bytes idle',
    },
    {
      id: 2,
      frames: 34,
      chip: 'v1.2–1.2.1 · 10 monoliths!',
      tone: 'warn',
      title: 'v1.2–1.2.1 · Add Hands, Build a Cage',
      sub: 'L0 read-only default · One-shot popups · client.js hit 16K lines',
    },
    {
      id: 3,
      frames: 34,
      chip: 'v1.3 · 45 modules',
      tone: 'ok',
      title: 'v1.3 · Split Monoliths Into 45 Modules',
      sub: '29 backend + 16 frontend modules · 0 cycles · O_EXCL file locks',
    },
    {
      id: 4,
      frames: 34,
      chip: 'v1.4 · 54 modules',
      tone: 'ok',
      title: 'v1.4 · Hold Execution, Stop Edit Stealing',
      sub: 'MD5-locked safety kernel on tools/pre-execute · Even L3 cannot bypass',
    },
    {
      id: 5,
      frames: 34,
      chip: 'v1.5–1.6 · 58 modules',
      tone: 'ok',
      title: 'v1.5–1.6 · 2,400T Desktop & Hard Cap',
      sub: '5 tabs & SVG Flow · Auto circuit breaker at 30 calls or 300K tokens',
    },
    {
      id: 6,
      frames: 34,
      chip: 'v1.7 · 83 modules',
      tone: 'ok',
      title: 'v1.7 · Main Tab, Local CLIs & Opt-In',
      sub: 'Local Codex / Claude dispatch · All 8 hooks skip plain chats by default',
    },
    {
      id: 7,
      frames: 38,
      chip: 'v1.8–1.9 · 95 modules',
      tone: 'ok',
      title: 'v1.8–1.9 · Theme Studio & 0-Byte Memory Hub',
      sub: '5+1 DIY skins · Bento Beam Flow · Gemini CLI · 2D/3D Starfield & Bridges',
    },
    {
      id: 8,
      frames: 52,
      chip: 'v2.0 · 101 modules · 0 deps',
      tone: 'good',
      title: 'v2.0 · Voice Chief, Mobile Pager & 3-Protocol Vector',
      sub: 'Speaker alerts · 6-ch pager · BM25/Links/Rollback · 53 backend + 48 frontend',
    },
  ],
}

function buildStageHtml(lang) {
  const isEn = lang === 'en'
  const scenesJson = JSON.stringify(SCENES[lang])
  const milesJson = JSON.stringify(MILESTONES[lang])

  return `<!DOCTYPE html>
<html lang="${isEn ? 'en' : 'zh-CN'}"><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html, body { width:${W}px; height:${H}px; overflow:hidden; background:#0b111c; color:#e2e8f0;
  font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
body { display:flex; flex-direction:column; position:relative;
  background-image:radial-gradient(rgba(148,163,184,0.11) 1px, transparent 1px);
  background-size:22px 22px; }
.top { height:46px; flex:0 0 auto; display:flex; align-items:center; justify-content:space-between;
  padding:0 24px; background:#0d1524; border-bottom:1px solid #1e293b; }
.top-l { display:flex; align-items:center; gap:10px; }
.logo { width:11px; height:11px; border-radius:50%; background:#38bdf8; border:2px solid #0b111c; outline:2px solid #2563eb; }
.brand { font-size:15px; font-weight:700; color:#f8fafc; letter-spacing:0.2px; }
.sep { color:#475569; font-size:13px; }
.subtop { font-size:12.5px; color:#94a3b8; font-weight:600; }
.top-r { display:flex; align-items:center; gap:8px; }
.chip { font-size:12px; font-weight:700; padding:4px 12px; border-radius:999px; border:1px solid #38bdf8;
  background:#13233d; color:#bae6fd; white-space:nowrap; }
.chip.warn { background:#33151e; border-color:#f87171; color:#fca5a5; }
.chip.ok { background:#11263d; border-color:#38bdf8; color:#bae6fd; }
.chip.good { background:#102a27; border-color:#34d399; color:#6ee7b7; }
.hero { height:74px; flex:0 0 auto; display:flex; flex-direction:column; align-items:center; justify-content:center;
  padding:6px 28px 0; text-align:center; gap:5px; }
.h1 { font-size:23px; font-weight:700; color:#f8fafc; line-height:1.2; letter-spacing:0.2px; }
.h2 { font-size:13.5px; font-weight:500; color:#94a3b8; line-height:1.25; }
.stage { height:292px; flex:0 0 auto; display:flex; align-items:center; justify-content:center; padding:0 30px; }
.stage svg { width:820px; height:292px; display:block; }
.timeline { height:83px; flex:0 0 auto; background:#0d1524; border-top:1px solid #1e293b;
  padding:11px 28px 8px; position:relative; display:flex; align-items:flex-start; justify-content:space-between; }
.track { position:absolute; left:68px; right:68px; top:22px; height:3px; background:#1e293b; border-radius:2px; }
.fill { height:100%; background:#34d399; border-radius:2px; width:0%; }
.node { position:relative; z-index:2; display:flex; flex-direction:column; align-items:center; width:86px; }
.dotwrap { height:24px; display:flex; align-items:center; justify-content:center; margin-bottom:3px; }
.ndot { width:20px; height:20px; border-radius:50%; display:flex; align-items:center; justify-content:center;
  font-size:10.5px; font-weight:700; border:2px solid #334155; background:#0b111c; color:#94a3b8; }
.node.done .ndot { background:#10b981; border-color:#34d399; color:#052e16; }
.node.curr .ndot { width:24px; height:24px; background:#0e2a47; border-color:#38bdf8; color:#7dd3fc; font-size:11px; }
.nver { font-size:11px; font-weight:700; color:#cbd5e1; line-height:1.2; }
.node.curr .nver { color:#7dd3fc; }
.node.done .nver { color:#6ee7b7; }
.nlab { font-size:10.5px; color:#94a3b8; line-height:1.2; margin-top:2px; }
.node.curr .nlab { color:#f1f5f9; font-weight:600; }
</style></head><body>
<div class="top">
  <div class="top-l">
    <span class="logo"></span>
    <span class="brand">dsh-chief</span>
    <span class="sep">·</span>
    <span class="subtop">${isEn ? 'Architecture Evolution' : '架构演进路线'}</span>
  </div>
  <div class="top-r"><span id="chip" class="chip"></span></div>
</div>
<div class="hero" id="hero">
  <div class="h1" id="h1"></div>
  <div class="h2" id="h2"></div>
</div>
<div class="stage" id="stage"></div>
<div class="timeline" id="timeline">
  <div class="track"><div class="fill" id="fill"></div></div>
  <div id="nodes" style="display:flex;width:100%;justify-content:space-between;"></div>
</div>
<script>
const IS_EN = ${isEn ? 'true' : 'false'};
const SCENES = ${scenesJson};
const MILES = ${milesJson};

const FRAME_MAP = [];
SCENES.forEach((sc, sIdx) => {
  for (let f = 0; f < sc.frames; f++) {
    FRAME_MAP.push({ sc, sIdx, f, n: sc.frames });
  }
});
window.__TOTAL_FRAMES = FRAME_MAP.length;
window.__SAMPLE_INDICES = SCENES.map((sc) => {
  let off = 0;
  for (const s of SCENES) {
    if (s.id === sc.id) return off + Math.min(28, s.frames - 1);
    off += s.frames;
  }
  return 0;
});

function easeOutCubic(x) {
  const c = Math.max(0, Math.min(1, x));
  return 1 - Math.pow(1 - c, 3);
}
function lerp(a, b, t) {
  return a + (b - a) * t;
}
function pointOnPolyline(pts, p) {
  const frac = ((p % 1) + 1) % 1;
  let total = 0;
  const segs = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const len = Math.hypot(dx, dy);
    segs.push({ a: pts[i], b: pts[i + 1], len });
    total += len;
  }
  let target = frac * total;
  for (const s of segs) {
    if (target <= s.len || s === segs[segs.length - 1]) {
      const u = s.len > 0 ? target / s.len : 0;
      return [lerp(s.a[0], s.b[0], u), lerp(s.a[1], s.b[1], u)];
    }
    target -= s.len;
  }
  return pts[0];
}
function pointOnQuad(p0, p1, p2, t) {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}

function svgScene1(u) {
  let ctxPct;
  if (u < 0.45) ctxPct = lerp(28, 88, u / 0.45);
  else if (u < 0.65) ctxPct = 88;
  else ctxPct = lerp(88, 24, easeOutCubic((u - 0.65) / 0.25));
  const ctxColor = ctxPct > 72 ? '#f59e0b' : ctxPct < 30 ? '#34d399' : '#38bdf8';
  const ringBorder = ctxPct > 72 ? '#f59e0b' : '#34d399';

  const orbitPts = [[368, 72], [472, 72], [632, 168], [632, 198], [188, 198], [188, 168]];
  const p1 = pointOnPolyline(orbitPts, u);
  const p2 = pointOnPolyline(orbitPts, u + 0.5);

  return \`<svg viewBox="0 0 820 292" width="820" height="292" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="14" width="350" height="154" rx="12" fill="#101b30" stroke="#38bdf8" stroke-width="1.8"/>
    <text x="38" y="44" fill="#f8fafc" font-size="16" font-weight="700">\${IS_EN ? 'Main Chat (@lead)' : '主对话 (@lead)'}</text>
    <text x="38" y="68" fill="#94a3b8" font-size="13">\${IS_EN ? 'Edits repo, runs commands, calls /compact' : '写代码、跑命令、长对话触发 /compact'}</text>
    <rect x="38" y="90" width="310" height="12" rx="6" fill="#0b1322" stroke="#233657"/>
    <rect x="38" y="90" width="\${(310 * ctxPct / 100).toFixed(1)}" height="12" rx="6" fill="\${ctxColor}"/>
    <text x="38" y="126" fill="#bae6fd" font-size="13" font-weight="600">\${ctxPct > 72 ? (IS_EN ? 'Context 88% -> rescuing findings first...' : '上下文 88% -> 先抢救核心结论落盘...') : (IS_EN ? 'After /compact: rescued notes ready (' + Math.round(ctxPct) + '%)' : '压缩完成：关键路径未丢 (' + Math.round(ctxPct) + '%)')}</text>
    <rect x="38" y="138" width="234" height="20" rx="5" fill="#102a27"/>
    <text x="48" y="152" fill="#6ee7b7" font-size="11.5" font-weight="600">\${IS_EN ? 'Zero forgotten paths or shell fixes' : '端口号、报错行号与路径 0 遗忘'}</text>

    <path d="M 368 72 L 472 72" stroke="#38bdf8" stroke-width="2" stroke-dasharray="5 4"/>
    <rect x="472" y="14" width="330" height="154" rx="12" fill="#102136" stroke="\${ringBorder}" stroke-width="2"/>
    <text x="492" y="44" fill="#38bdf8" font-size="16" font-weight="700">\${IS_EN ? 'dnb- Side Co-Pilot' : 'dnb- 右侧副驾'}</text>
    <text x="492" y="68" fill="#cbd5e1" font-size="13">\${IS_EN ? 'Read-only watcher · 0 background calls' : '只看不动手 · 默认 0 后台模型调用'}</text>
    <rect x="492" y="88" width="290" height="28" rx="6" fill="#152b47" stroke="#2b4a78"/>
    <text x="506" y="106" fill="#e2e8f0" font-size="12.5">\${IS_EN ? 'Exact provider/model channel sync' : '严格对齐主对话 provider/model 渠道'}</text>
    <rect x="492" y="124" width="290" height="28" rx="6" fill="#102a27" stroke="#245c50"/>
    <text x="506" y="142" fill="#6ee7b7" font-size="12.5">\${IS_EN ? 'v1.1: Pre-compact disk verify + API probe' : 'v1.1：压缩前写盘核验 + 旧宿主探测'}</text>

    <path d="M 632 168 L 632 198 L 188 198 L 188 168" fill="none" stroke="#34d399" stroke-width="2" stroke-dasharray="5 4"/>
    <circle cx="\${p1[0].toFixed(1)}" cy="\${p1[1].toFixed(1)}" r="5" fill="#34d399"/>
    <circle cx="\${p2[0].toFixed(1)}" cy="\${p2[1].toFixed(1)}" r="5" fill="#38bdf8"/>

    <rect x="18" y="198" width="784" height="82" rx="12" fill="#0f1c2e" stroke="#2b456b" stroke-width="1.6"/>
    <text x="38" y="224" fill="#7dd3fc" font-size="14" font-weight="700">\${IS_EN ? '4-Tier Cold Archive Cabinet (0 Bytes Injected While Sealed)' : '四层冷存储档案柜（平时 0 字节注入提示词 · 需要才调取）'}</text>
    <rect x="38" y="236" width="166" height="32" rx="7" fill="#172845" stroke="#334c78"/>
    <text x="121" y="257" text-anchor="middle" fill="#e2e8f0" font-size="13">\${IS_EN ? '1. Drawers' : '1. 档案抽屉'}</text>
    <text x="219" y="257" text-anchor="middle" fill="#64748b" font-size="15">→</text>
    <rect x="234" y="236" width="184" height="32" rx="7" fill="#212217" stroke="#a16207"/>
    <text x="326" y="257" text-anchor="middle" fill="#fde68a" font-size="13">\${IS_EN ? '2. Clip Dossiers' : '2. 金银铜卷宗'}</text>
    <text x="433" y="257" text-anchor="middle" fill="#64748b" font-size="15">→</text>
    <rect x="448" y="236" width="166" height="32" rx="7" fill="#172845" stroke="#334c78"/>
    <text x="531" y="257" text-anchor="middle" fill="#e2e8f0" font-size="13">\${IS_EN ? '3. Memory Points' : '3. 记忆要点'}</text>
    <text x="629" y="257" text-anchor="middle" fill="#64748b" font-size="15">→</text>
    <rect x="644" y="236" width="138" height="32" rx="7" fill="#172845" stroke="#334c78"/>
    <text x="713" y="257" text-anchor="middle" fill="#e2e8f0" font-size="13">\${IS_EN ? '4. Sub-Points' : '4. 细节展开'}</text>
  </svg>\`;
}

function svgScene2(u) {
  const d1 = lerp(262, 318, (u * 2) % 1);
  const d2 = lerp(506, 560, (u * 2) % 1);
  const pulseOn = Math.floor(u * 8) % 2 === 0;
  const barW = Math.round(744 * lerp(0.32, 0.96, easeOutCubic(Math.min(1, u * 1.4))));
  const warnBorder = pulseOn ? '#f87171' : '#f59e0b';
  const cageBorder = pulseOn ? '#34d399' : '#38bdf8';

  return \`<svg viewBox="0 0 820 292" width="820" height="292" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="14" width="242" height="148" rx="12" fill="#12213b" stroke="#38bdf8" stroke-width="1.8"/>
    <text x="139" y="46" text-anchor="middle" fill="#f8fafc" font-size="15.5" font-weight="700">chief-executor</text>
    <text x="139" y="70" text-anchor="middle" fill="#94a3b8" font-size="13">\${IS_EN ? 'Direct repo & tool action' : '装上手：直接查工程与调压缩'}</text>
    <rect x="38" y="88" width="202" height="26" rx="6" fill="#182b47"/>
    <text x="139" y="105" text-anchor="middle" fill="#bae6fd" font-size="12.5">\${IS_EN ? '3 Cold Vaults + Smart Compact' : '三层档案金库 + 智选压缩'}</text>
    <rect x="38" y="122" width="202" height="24" rx="6" fill="#2c161f" stroke="#f87171"/>
    <text x="139" y="138" text-anchor="middle" fill="#fca5a5" font-size="12" font-weight="700">\${IS_EN ? 'Red Halt kills loops instantly' : '输入栏红色急停一秒切断'}</text>

    <path d="M 260 88 L 316 88" stroke="#38bdf8" stroke-width="2.5"/>
    <circle cx="\${d1.toFixed(1)}" cy="88" r="4.5" fill="#7dd3fc"/>

    <rect x="316" y="14" width="190" height="148" rx="12" fill="#102a27" stroke="\${cageBorder}" stroke-width="2.2"/>
    <rect x="399" y="28" width="24" height="18" rx="4" fill="none" stroke="#6ee7b7" stroke-width="2.2"/>
    <path d="M 404 28 V 23 A 7 7 0 0 1 418 23 V 28" fill="none" stroke="#6ee7b7" stroke-width="2.2"/>
    <text x="411" y="68" text-anchor="middle" fill="#6ee7b7" font-size="15.5" font-weight="700">\${IS_EN ? 'L0–L3 Lock Cage' : 'L0–L3 制度笼子'}</text>
    <text x="411" y="92" text-anchor="middle" fill="#e2e8f0" font-size="13">\${IS_EN ? 'L0 Read-Only Default' : '新会话一律 L0 只读起步'}</text>
    <text x="411" y="114" text-anchor="middle" fill="#cbd5e1" font-size="12.5">\${IS_EN ? '6-Stage Gate · One-Shot Ask' : '6 级安全门 · 逐项弹窗放行'}</text>
    <text x="411" y="138" text-anchor="middle" fill="#fcd34d" font-size="12">\${IS_EN ? 'L3 Risk Ack Required' : '切入最高档须强制勾选风险'}</text>

    <path d="M 506 88 L 560 88" stroke="#34d399" stroke-width="2.5"/>
    <circle cx="\${d2.toFixed(1)}" cy="88" r="4.5" fill="#6ee7b7"/>

    <rect x="560" y="14" width="242" height="148" rx="12" fill="#12213b" stroke="#34d399" stroke-width="1.8"/>
    <text x="681" y="46" text-anchor="middle" fill="#6ee7b7" font-size="15.5" font-weight="700">\${IS_EN ? 'Controlled Execution' : '安全落地 + 审计留痕'}</text>
    <text x="681" y="72" text-anchor="middle" fill="#cbd5e1" font-size="13">\${IS_EN ? 'No rogue git reset or .env leak' : '严防误删强推与密钥外泄'}</text>
    <rect x="580" y="92" width="202" height="50" rx="7" fill="#10262b" stroke="#2c7a67"/>
    <text x="681" y="113" text-anchor="middle" fill="#a7f3d0" font-size="12.5">\${IS_EN ? 'Handoff drops cleanly back to L0' : '跨窗交接新会话自动降回只读'}</text>
    <text x="681" y="131" text-anchor="middle" fill="#94a3b8" font-size="11.5">\${IS_EN ? 'Security rules now hold...' : '安全规矩立住了，代码却快挤炸'}</text>

    <rect x="18" y="180" width="784" height="100" rx="12" fill="#29171e" stroke="\${warnBorder}" stroke-width="2.2"/>
    <polygon points="48,195 36,216 60,216" fill="#f59e0b"/>
    <rect x="46.5" y="201" width="3" height="8" fill="#1f1118"/>
    <rect x="46.5" y="211" width="3" height="3" fill="#1f1118"/>
    <text x="70" y="212" fill="#fca5a5" font-size="15" font-weight="700">\${IS_EN ? 'MONOLITH CRISIS: Entire Plugin Crammed Into 10 Files' : '巨石膨胀危机：全插件仍挤在 10 个文件里 (3.3 万行代码)'}</text>
    <rect x="38" y="226" width="744" height="14" rx="7" fill="#180d12" stroke="#4c2330"/>
    <rect x="38" y="226" width="\${barW}" height="14" rx="7" fill="\${barW > 560 ? '#f87171' : '#f59e0b'}"/>
    <text x="38" y="264" fill="#fde68a" font-size="13" font-weight="600">\${IS_EN ? 'client.js: 16,749 lines  |  chief.js: 8,008 lines  |  index.js: 6,075 lines — NTFS locks collide!' : 'client.js 16,749 行  |  chief.js 8,008 行  |  index.js 6,075 行 — 并发易丢锁、改一处动全身'}</text>
  </svg>\`;
}

function svgScene3(u) {
  const waveCol = (u * 14) % 8;
  let beCells = '';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 7; c++) {
      if (r === 3 && c === 6) continue;
      const dist = Math.abs(c - (waveCol % 7));
      const lit = dist < 1.1;
      beCells += \`<rect x="\${42 + c * 36}" y="\${58 + r * 26}" width="29" height="19" rx="4" fill="\${lit ? '#1d4ed8' : '#162844'}" stroke="\${lit ? '#7dd3fc' : '#38bdf8'}" stroke-width="1.2"/>\`;
    }
  }
  beCells += \`<rect x="\${42 + 6 * 36}" y="\${58 + 3 * 26}" width="29" height="19" rx="4" fill="#1e40af" stroke="#93c5fd" stroke-width="1.2"/>\`;

  let feCells = '';
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      const dist = Math.abs(c - ((u * 9) % 4));
      const lit = dist < 1.05;
      feCells += \`<rect x="\${554 + c * 52}" y="\${58 + r * 26}" width="42" height="19" rx="4" fill="\${lit ? '#059669' : '#12302d'}" stroke="\${lit ? '#a7f3d0' : '#34d399'}" stroke-width="1.2"/>\`;
    }
  }

  const pGap = (u * 5) % 1;
  const pLeft = lerp(316, 340, pGap);
  const pRight = lerp(500, 524, pGap);
  const p1Lit = u > 0.14 ? 1 : 0.25;
  const p2Lit = u > 0.30 ? 1 : 0.25;
  const p3Lit = u > 0.46 ? 1 : 0.25;

  return \`<svg viewBox="0 0 820 292" width="820" height="292" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="10" width="296" height="172" rx="12" fill="#0f1b30" stroke="#38bdf8" stroke-width="1.8"/>
    <text x="42" y="38" fill="#7dd3fc" font-size="15" font-weight="700">\${IS_EN ? '29 Backend Modules' : '29 个独立后端模块'}</text>
    \${beCells}
    <text x="42" y="170" fill="#94a3b8" font-size="11.5">\${IS_EN ? 'Single DI Hub + Acyclic DAG Layers' : 'index.js 统一装配 · 严格无环分层'}</text>

    <path d="M 314 96 L 342 96" stroke="#38bdf8" stroke-width="2.5"/>
    <circle cx="\${pLeft.toFixed(1)}" cy="96" r="4.5" fill="#7dd3fc"/>
    <path d="M 498 96 L 526 96" stroke="#34d399" stroke-width="2.5"/>
    <circle cx="\${pRight.toFixed(1)}" cy="96" r="4.5" fill="#6ee7b7"/>

    <rect x="342" y="54" width="156" height="84" rx="10" fill="#102a27" stroke="#34d399" stroke-width="2"/>
    <text x="420" y="84" text-anchor="middle" fill="#6ee7b7" font-size="13.5" font-weight="700">build-client.mjs</text>
    <text x="420" y="106" text-anchor="middle" fill="#e2e8f0" font-size="12.5">\${IS_EN ? 'Topo Bundler' : '拓扑排序打包器'}</text>
    <text x="420" y="125" text-anchor="middle" fill="#94a3b8" font-size="11.5">0 external deps</text>

    <rect x="526" y="10" width="276" height="172" rx="12" fill="#0f1f29" stroke="#34d399" stroke-width="1.8"/>
    <text x="554" y="38" fill="#6ee7b7" font-size="15" font-weight="700">\${IS_EN ? '16 Frontend ES Modules' : '16 个前端 ES 模块'}</text>
    \${feCells}
    <text x="554" y="170" fill="#94a3b8" font-size="11.5">\${IS_EN ? 'Single store · 100% API compat' : 'store 单一状态中心 · 公开接口全兼容'}</text>

    <rect x="18" y="200" width="248" height="80" rx="10" fill="#111d33" stroke="#3b82f6" stroke-width="1.8" opacity="\${p1Lit}"/>
    <text x="142" y="232" text-anchor="middle" fill="#93c5fd" font-size="14.5" font-weight="700">\${IS_EN ? 'CI Structural Gates' : '0 循环依赖 · 0 可变导出'}</text>
    <text x="142" y="256" text-anchor="middle" fill="#cbd5e1" font-size="12.5">\${IS_EN ? 'Node 22/24 · Zero cycles' : 'Node 22/24 自动门禁锁死结构'}</text>

    <rect x="286" y="200" width="248" height="80" rx="10" fill="#102a27" stroke="#34d399" stroke-width="1.8" opacity="\${p2Lit}"/>
    <text x="410" y="232" text-anchor="middle" fill="#6ee7b7" font-size="14.5" font-weight="700">\${IS_EN ? 'O_EXCL Spin File Locks' : 'O_EXCL 并发文件钢锁'}</text>
    <text x="410" y="256" text-anchor="middle" fill="#cbd5e1" font-size="12.5">\${IS_EN ? 'NTFS retry · Auto-resume' : '防 Windows 撞锁 · 批准后自动续跑'}</text>

    <rect x="554" y="200" width="248" height="80" rx="10" fill="#231c15" stroke="#f59e0b" stroke-width="1.8" opacity="\${p3Lit}"/>
    <text x="678" y="232" text-anchor="middle" fill="#fcd34d" font-size="14.5" font-weight="700">\${IS_EN ? 'Audit + De-obfuscate' : '独立审计 + 命令反混淆'}</text>
    <text x="678" y="256" text-anchor="middle" fill="#fde68a" font-size="12.5">\${IS_EN ? 'chief-audit.jsonl · ADS guard' : 'Base64 / ^ 引号 / ADS 流全拦截'}</text>
  </svg>\`;
}

function svgScene4(u) {
  const cyc = (u * 2) % 1;
  const gX = lerp(218, 594, easeOutCubic(Math.min(1, cyc * 1.15)));
  const gAlpha = cyc > 0.88 ? (1 - (cyc - 0.88) / 0.12) : 1;

  let rX, rY, hitFlash = 0;
  if (cyc < 0.42) {
    const t = cyc / 0.42;
    rX = lerp(218, 300, t);
    rY = lerp(220, 206, t);
  } else {
    const t = (cyc - 0.42) / 0.58;
    hitFlash = t < 0.25 ? 1 : 0;
    const pos = pointOnQuad([300, 206], [244, 244], [218, 256], Math.min(1, t * 1.2));
    rX = pos[0];
    rY = pos[1];
  }
  const denyFlash = cyc >= 0.42 && cyc < 0.88 ? 1 : 0;

  return \`<svg viewBox="0 0 820 292" width="820" height="292" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="16" width="200" height="72" rx="10" fill="#12213b" stroke="#38bdf8" stroke-width="1.8"/>
    <text x="118" y="45" text-anchor="middle" fill="#7dd3fc" font-size="15" font-weight="700">\${IS_EN ? 'Main Chat (@lead)' : '主对话 (@lead)'}</text>
    <text x="118" y="69" text-anchor="middle" fill="#cbd5e1" font-size="12.5">\${IS_EN ? 'Owns actual repo edits' : '实际动手改代码与跑命令'}</text>

    <rect x="18" y="106" width="200" height="66" rx="10" fill="#12213b" stroke="#60a5fa" stroke-width="1.6"/>
    <text x="118" y="135" text-anchor="middle" fill="#93c5fd" font-size="14.5" font-weight="700">\${IS_EN ? 'Subagents (@sub)' : '子代理 (@sub)'}</text>
    <text x="118" y="157" text-anchor="middle" fill="#cbd5e1" font-size="12">\${IS_EN ? 'Inherit all redlines' : '并行分派与继承红线'}</text>

    <rect x="18" y="190" width="200" height="90" rx="10" fill="#172038" stroke="#a78bfa" stroke-width="1.8"/>
    <text x="118" y="218" text-anchor="middle" fill="#c4b5fd" font-size="14.5" font-weight="700">\${IS_EN ? 'Lazy Chief (Advisor)' : '参谋长（懒介入）'}</text>
    <text x="118" y="241" text-anchor="middle" fill="#e2e8f0" font-size="12">\${IS_EN ? 'Delegates edits to @lead' : '绝不抢代码，派 @lead 改'}</text>
    <text x="118" y="261" text-anchor="middle" fill="#6ee7b7" font-size="12">\${IS_EN ? 'Quiet [INQUIRY] Q&amp;A' : '缺细节走 [INQUIRY] 零打断'}</text>

    <path d="M 218 68 L 594 68" stroke="#245c50" stroke-width="2" stroke-dasharray="5 4"/>
    <path d="M 218 220 L 304 206" stroke="#4c2330" stroke-width="2" stroke-dasharray="5 4"/>
    <path d="M 300 206 Q 244 244 218 256" fill="none" stroke="#f87171" stroke-width="1.5" stroke-dasharray="4 4" opacity="\${denyFlash}"/>

    <rect x="304" y="14" width="218" height="266" rx="12" fill="#181928" stroke="\${hitFlash ? '#f87171' : '#34d399'}" stroke-width="2.4"/>
    <rect x="322" y="28" width="182" height="36" rx="8" fill="#2c161f" stroke="#f87171"/>
    <text x="413" y="51" text-anchor="middle" fill="#fca5a5" font-size="14" font-weight="700">tools/pre-execute</text>
    <text x="413" y="88" text-anchor="middle" fill="#f8fafc" font-size="15" font-weight="700">\${IS_EN ? 'Physical Guard Walls' : '事前物理驻墙防线'}</text>
    <text x="413" y="111" text-anchor="middle" fill="#93c5fd" font-size="12.5">\${IS_EN ? 'Global | Workspace | Paused' : '全局 / 本工程 / 暂挂'}</text>

    <rect x="324" y="128" width="178" height="66" rx="8" fill="#102a27" stroke="#34d399"/>
    <text x="413" y="152" text-anchor="middle" fill="#6ee7b7" font-size="14" font-weight="700">pkg/safety/ (9 Modules)</text>
    <text x="413" y="174" text-anchor="middle" fill="#a7f3d0" font-size="12">\${IS_EN ? 'Zero business deps · MD5 lock' : '零业务耦合 · MD5 锁定内核'}</text>

    <rect x="324" y="208" width="178" height="56" rx="8" fill="#231c15" stroke="#f59e0b"/>
    <text x="413" y="231" text-anchor="middle" fill="#fcd34d" font-size="13" font-weight="700">\${IS_EN ? 'Even L3 Cannot Remove' : 'L3 权限也拆不掉已锁墙'}</text>
    <text x="413" y="250" text-anchor="middle" fill="#fde68a" font-size="11.5">\${IS_EN ? 'Blocks require human review' : '撞死只能提交审批单请示人类'}</text>

    <rect x="594" y="16" width="208" height="114" rx="12" fill="#102a27" stroke="#34d399" stroke-width="2"/>
    <text x="698" y="48" text-anchor="middle" fill="#6ee7b7" font-size="15.5" font-weight="700">✓ \${IS_EN ? 'Safe Pass' : '安全放行'}</text>
    <text x="698" y="74" text-anchor="middle" fill="#d1fae5" font-size="13">\${IS_EN ? 'Workspace reads &amp; edits' : '工作区内正常读写'}</text>
    <text x="698" y="96" text-anchor="middle" fill="#a7f3d0" font-size="12">\${IS_EN ? 'Logged cleanly to audit' : '合规命令顺畅执行并记账'}</text>

    <rect x="594" y="154" width="208" height="126" rx="12" fill="\${denyFlash ? '#361722' : '#26141b'}" stroke="#f87171" stroke-width="\${denyFlash ? 2.6 : 1.8}"/>
    <text x="698" y="188" text-anchor="middle" fill="#fca5a5" font-size="15.5" font-weight="700">✕ \${IS_EN ? 'Hard Blocked' : '撞墙拦下'}</text>
    <text x="698" y="214" text-anchor="middle" fill="#fecaca" font-size="13">\${IS_EN ? 'Out-of-repo writes' : '越界修改 · .env 凭据'}</text>
    <text x="698" y="236" text-anchor="middle" fill="#fda4af" font-size="12.5">\${IS_EN ? '.env · Locked paths' : '命中物理驻墙直接拒止'}</text>
    <text x="698" y="260" text-anchor="middle" fill="#f87171" font-size="11.5" font-weight="700">\${denyFlash ? (IS_EN ? 'DENY VERDICT WRITTEN' : '已写入拒绝审计！') : (IS_EN ? 'Waiting for pre-execute' : '实时事前门禁守护中')}</text>

    <circle cx="\${gX.toFixed(1)}" cy="68" r="6" fill="#34d399" opacity="\${gAlpha.toFixed(2)}"/>
    \${hitFlash ? '<circle cx="302" cy="206" r="11" fill="none" stroke="#f87171" stroke-width="2.5"/>' : ''}
    <circle cx="\${rX.toFixed(1)}" cy="\${rY.toFixed(1)}" r="6" fill="#f87171"/>
  </svg>\`;
}

function svgScene5(u) {
  const deskFill = Math.round(212 * lerp(0.35, 0.72, easeOutCubic(Math.min(1, u * 1.4))));
  const capPct = Math.min(1, u * 1.35);
  const capFill = Math.round(212 * capPct);
  const tripped = capPct >= 0.99;
  const rotDeg = Math.round((u * 360) % 360);
  const arcPt = pointOnQuad([498, 178], [412, 232], [326, 178], (u * 2) % 1);

  return \`<svg viewBox="0 0 820 292" width="820" height="292" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="16" width="248" height="262" rx="12" fill="#101d33" stroke="#38bdf8" stroke-width="1.8"/>
    <text x="142" y="48" text-anchor="middle" fill="#7dd3fc" font-size="16" font-weight="700">\${IS_EN ? 'Cognitive Desktop' : '认知桌面 · 省上下文'}</text>
    <text x="142" y="72" text-anchor="middle" fill="#cbd5e1" font-size="12.5">\${IS_EN ? 'Only pinned blotter enters prompts' : '全三库只有置顶处每轮发给模型'}</text>
    <rect x="36" y="96" width="212" height="58" rx="8" fill="#142b47" stroke="#2b4a78"/>
    <text x="142" y="119" text-anchor="middle" fill="#f8fafc" font-size="13.5" font-weight="700">\${IS_EN ? '2,400 Tokens / 6 Items' : '硬上限：2,400T / 6 份'}</text>
    <rect x="46" y="132" width="192" height="10" rx="5" fill="#0b1322"/>
    <rect x="46" y="132" width="\${Math.min(192, deskFill)}" height="10" rx="5" fill="#38bdf8"/>
    <rect x="36" y="170" width="212" height="90" rx="8" fill="#151e33" stroke="#6366f1"/>
    <text x="142" y="196" text-anchor="middle" fill="#c7d2fe" font-size="13.5" font-weight="700">\${IS_EN ? 'Hooks + Dream Roam' : '抽屉关键词钩子 + 梦境漫游'}</text>
    <text x="142" y="220" text-anchor="middle" fill="#a5b4fc" font-size="12">\${IS_EN ? 'Off-desk files stay 0 bytes' : '其余档案 0 字节存抽屉按需拉取'}</text>
    <text x="142" y="242" text-anchor="middle" fill="#94a3b8" font-size="11.5">\${IS_EN ? 'Quietly sorts drafts idle' : '空闲时悄悄分拣草稿与织钩'}</text>

    <rect x="284" y="16" width="252" height="262" rx="12" fill="#0f1b2e" stroke="#3b82f6" stroke-width="1.8"/>
    <g transform="translate(322, 42) rotate(\${rotDeg})">
      <circle cx="0" cy="0" r="7.5" fill="none" stroke="#93c5fd" stroke-width="2.4"/>
      <circle cx="0" cy="0" r="2.2" fill="#93c5fd"/>
      <line x1="0" y1="-11" x2="0" y2="-7" stroke="#93c5fd" stroke-width="2.4"/>
      <line x1="0" y1="7" x2="0" y2="11" stroke="#93c5fd" stroke-width="2.4"/>
      <line x1="-11" y1="0" x2="-7" y2="0" stroke="#93c5fd" stroke-width="2.4"/>
      <line x1="7" y1="0" x2="11" y2="0" stroke="#93c5fd" stroke-width="2.4"/>
      <line x1="-7.8" y1="-7.8" x2="-5" y2="-5" stroke="#93c5fd" stroke-width="2.2"/>
      <line x1="5" y1="5" x2="7.8" y2="7.8" stroke="#93c5fd" stroke-width="2.2"/>
      <line x1="7.8" y1="-7.8" x2="5" y2="-5" stroke="#93c5fd" stroke-width="2.2"/>
      <line x1="-5" y1="5" x2="-7.8" y2="7.8" stroke="#93c5fd" stroke-width="2.2"/>
    </g>
    <text x="424" y="48" text-anchor="middle" fill="#f8fafc" font-size="15.5" font-weight="700">\${IS_EN ? '5 Tabs + SVG Flow' : '5 页签 + SVG 流程'}</text>
    <text x="410" y="74" text-anchor="middle" fill="#94a3b8" font-size="12">\${IS_EN ? 'Collapsible Org Tree · 180° Effort' : '默认收起组织树 · 180° 思考表盘'}</text>

    <rect x="302" y="124" width="60" height="44" rx="7" fill="#102a27" stroke="#34d399"/>
    <text x="332" y="150" text-anchor="middle" fill="#6ee7b7" font-size="12" font-weight="700">\${IS_EN ? '1.Scan' : '1.扫盘'}</text>
    <path d="M 362 146 L 380 146" stroke="#34d399" stroke-width="2"/>
    <rect x="380" y="124" width="60" height="44" rx="7" fill="#142942" stroke="#38bdf8"/>
    <text x="410" y="150" text-anchor="middle" fill="#7dd3fc" font-size="12" font-weight="700">\${IS_EN ? '2.Edit' : '2.修改'}</text>
    <path d="M 440 146 L 458 146" stroke="#38bdf8" stroke-width="2"/>
    <rect x="458" y="124" width="60" height="44" rx="7" fill="#182236" stroke="#64748b"/>
    <text x="488" y="150" text-anchor="middle" fill="#cbd5e1" font-size="12" font-weight="700">\${IS_EN ? '3.Test' : '3.验收'}</text>

    <path d="M 498 178 Q 412 232 326 178" fill="none" stroke="#f59e0b" stroke-width="2" stroke-dasharray="5 4"/>
    <circle cx="\${arcPt[0].toFixed(1)}" cy="\${arcPt[1].toFixed(1)}" r="4.5" fill="#fbbf24"/>
    <text x="412" y="218" text-anchor="middle" fill="#fcd34d" font-size="11.5">\${IS_EN ? '@qa return edge' : '@qa 异常回指路径'}</text>

    <rect x="302" y="234" width="216" height="28" rx="6" fill="#16233a"/>
    <text x="410" y="253" text-anchor="middle" fill="#cbd5e1" font-size="12">\${IS_EN ? '3 Presets · Live zh / en · Light UI' : '3 档预设 · 双语 · 浅色主题补齐'}</text>

    <rect x="554" y="16" width="248" height="262" rx="12" fill="#101f29" stroke="\${tripped ? '#34d399' : '#f59e0b'}" stroke-width="1.8"/>
    <text x="678" y="48" text-anchor="middle" fill="#6ee7b7" font-size="16" font-weight="700">\${IS_EN ? 'Away Hard Safety Net' : '离桌托管三重熔断'}</text>
    <text x="678" y="72" text-anchor="middle" fill="#cbd5e1" font-size="12.5">\${IS_EN ? 'Off = 0 · Patrol = fault-only' : '关停 / 巡检空闲时 0 消耗'}</text>
    <rect x="572" y="96" width="212" height="66" rx="8" fill="\${tripped ? '#102a27' : '#271d12'}" stroke="\${tripped ? '#34d399' : '#f59e0b'}"/>
    <text x="678" y="119" text-anchor="middle" fill="\${tripped ? '#6ee7b7' : '#fcd34d'}" font-size="13.5" font-weight="700">\${tripped ? (IS_EN ? 'CAP HIT -> AUTO HALTED' : '达上限 -> 自动熔断停机') : (IS_EN ? 'Cap: 30 Calls / 300K Tok' : '硬熔断：30 次 / 300K')}</text>
    <rect x="582" y="132" width="192" height="10" rx="5" fill="#0b1322"/>
    <rect x="582" y="132" width="\${Math.min(192, capFill)}" height="10" rx="5" fill="\${tripped ? '#34d399' : '#f59e0b'}"/>
    <text x="678" y="156" text-anchor="middle" fill="#94a3b8" font-size="11">\${IS_EN ? 'Manual Q&amp;A always exempt' : 'chat/review/dream 分账 · 提问豁免'}</text>

    <rect x="572" y="176" width="212" height="84" rx="8" fill="#14233d" stroke="#2c4a75"/>
    <text x="678" y="201" text-anchor="middle" fill="#bae6fd" font-size="13" font-weight="700">\${IS_EN ? '7 Alerts + 5-Check Sleep' : '7 类提醒 + 15m 自动休眠'}</text>
    <text x="678" y="224" text-anchor="middle" fill="#cbd5e1" font-size="12">\${IS_EN ? 'Quiet first-load baseline' : '新会话静默基线 · 闲置归零'}</text>
    <text x="678" y="246" text-anchor="middle" fill="#94a3b8" font-size="11.5">\${IS_EN ? 'Redacted .md battle report' : '导出 [REDACTED] 脱敏复盘战报'}</text>
  </svg>\`;
}

function svgScene6(u) {
  const pulse = (u * 2.2) % 1;
  const pTL = [lerp(334, 240, pulse), lerp(128, 108, pulse)];
  const pTR = [lerp(486, 580, pulse), lerp(128, 108, pulse)];
  const pBL = [lerp(334, 240, pulse), lerp(164, 184, pulse)];
  const pBR = [lerp(486, 580, pulse), lerp(164, 184, pulse)];
  const hubGlow = Math.floor(u * 6) % 2 === 0 ? '#34d399' : '#38bdf8';

  return \`<svg viewBox="0 0 820 292" width="820" height="292" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="10" width="784" height="50" rx="10" fill="#12243d" stroke="#38bdf8" stroke-width="1.8"/>
    <text x="410" y="32" text-anchor="middle" fill="#7dd3fc" font-size="14.5" font-weight="700">\${IS_EN ? 'Main Conversation Tab (conversation.view · Full-Width Cockpit)' : '顶部「参谋长」主页面大屏 (conversation.view)'}</text>
    <text x="410" y="50" text-anchor="middle" fill="#cbd5e1" font-size="12">\${IS_EN ? 'Hides duplicate bottom composer · Subagents open as sidebar tabs (Fixes #5)' : '自动隐藏宿主底部重复主框 · 子代理默认在现有右侧栏加页签防堆叠 (#5)'}</text>

    <path d="M 240 106 L 334 128" stroke="#38bdf8" stroke-width="2" stroke-dasharray="5 4"/>
    <path d="M 580 106 L 486 128" stroke="#60a5fa" stroke-width="2" stroke-dasharray="5 4"/>
    <path d="M 240 186 L 334 164" stroke="#34d399" stroke-width="2" stroke-dasharray="5 4"/>
    <path d="M 580 186 L 486 164" stroke="#a78bfa" stroke-width="2" stroke-dasharray="5 4"/>

    <rect x="18" y="76" width="222" height="56" rx="10" fill="#111f36" stroke="#38bdf8" stroke-width="1.6"/>
    <text x="129" y="100" text-anchor="middle" fill="#bae6fd" font-size="14" font-weight="700">\${IS_EN ? 'Main Chat (@lead)' : '主对话 (@lead)'}</text>
    <text x="129" y="120" text-anchor="middle" fill="#94a3b8" font-size="12">\${IS_EN ? 'Sees full squad &amp; peers' : '掌握全编队与外协全局视野'}</text>

    <rect x="580" y="76" width="222" height="56" rx="10" fill="#111f36" stroke="#60a5fa" stroke-width="1.6"/>
    <text x="691" y="100" text-anchor="middle" fill="#bfdbfe" font-size="14" font-weight="700">\${IS_EN ? 'Subagents (@sub)' : '子代理 (@sub)'}</text>
    <text x="691" y="120" text-anchor="middle" fill="#94a3b8" font-size="12">\${IS_EN ? 'Tab reuse, zero pane stack' : '点开加页签去重，告别多层分屏'}</text>

    <rect x="334" y="110" width="152" height="72" rx="12" fill="#132b45" stroke="\${hubGlow}" stroke-width="2.2"/>
    <text x="410" y="140" text-anchor="middle" fill="#f8fafc" font-size="15.5" font-weight="700">\${IS_EN ? 'Collab System' : '协同系统'}</text>
    <text x="410" y="164" text-anchor="middle" fill="#7dd3fc" font-size="12">\${IS_EN ? 'Idle static · Active flow' : '空闲全静止 · 工作态流光'}</text>

    <rect x="18" y="158" width="222" height="56" rx="10" fill="#102a27" stroke="#34d399" stroke-width="1.6"/>
    <text x="129" y="182" text-anchor="middle" fill="#6ee7b7" font-size="14" font-weight="700">\${IS_EN ? 'Local Codex / Claude' : '直连本机 Codex / Claude'}</text>
    <text x="129" y="202" text-anchor="middle" fill="#a7f3d0" font-size="11.5">\${IS_EN ? 'With Guard Walls · Pair mail flow' : '免 ccSwitch · 带物理墙派单'}</text>

    <rect x="580" y="158" width="222" height="56" rx="10" fill="#1b1a36" stroke="#a78bfa" stroke-width="1.6"/>
    <text x="691" y="182" text-anchor="middle" fill="#ddd6fe" font-size="14" font-weight="700">\${IS_EN ? 'Clean Standby Scan' : '待命池净化与唤醒'}</text>
    <text x="691" y="202" text-anchor="middle" fill="#c4b5fd" font-size="11.5">\${IS_EN ? 'Filters Mnemon &amp; blank shells' : '剔除 Mnemon 与空白空壳会话'}</text>

    <circle cx="\${pTL[0].toFixed(1)}" cy="\${pTL[1].toFixed(1)}" r="4.5" fill="#38bdf8"/>
    <circle cx="\${pTR[0].toFixed(1)}" cy="\${pTR[1].toFixed(1)}" r="4.5" fill="#60a5fa"/>
    <circle cx="\${pBL[0].toFixed(1)}" cy="\${pBL[1].toFixed(1)}" r="4.5" fill="#34d399"/>
    <circle cx="\${pBR[0].toFixed(1)}" cy="\${pBR[1].toFixed(1)}" r="4.5" fill="#a78bfa"/>

    <rect x="18" y="228" width="784" height="54" rx="12" fill="#0d2922" stroke="#34d399" stroke-width="2.2"/>
    <path d="M 48 242 L 60 247 V 256 C 60 264 54 268 48 270 C 42 268 36 264 36 256 V 247 Z" fill="#10b981" stroke="#a7f3d0" stroke-width="1.5"/>
    <text x="74" y="252" fill="#6ee7b7" font-size="14" font-weight="700">\${IS_EN ? 'Restraint at Full Power: Opt-In Zero Intrusion (sessionEnabled · Fixes #6)' : '权力的克制：普通聊天窗口默认 0 侵入直通 (sessionEnabled · #6)'}</text>
    <text x="74" y="271" fill="#d1fae5" font-size="12">\${IS_EN ? 'All 8 hooks skip plain chats until enabled · 44 backend + 39 frontend modules · 0 external deps' : '未启用时全 8 处后端钩子直接放行 · 44 后端 + 39 前端模块 · 召之即来，不召则静'}</text>
  </svg>\`;
}

function svgScene7(u) {
  const stepProgress = (u * 3) % 1;
  const flowX = lerp(96, 336, stepProgress);
  const starPulse = (Math.sin(u * Math.PI * 4) * 0.5 + 0.5).toFixed(2);
  return \`<svg viewBox="0 0 820 292" width="820" height="292" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="14" width="386" height="148" rx="12" fill="#101b30" stroke="#38bdf8" stroke-width="1.8"/>
    <text x="36" y="42" fill="#7dd3fc" font-size="14.5" font-weight="700">\${IS_EN ? 'Bento Beam Flow &amp; Adaptive 5+1 Themes' : 'Bento 目标圆环 + 蛇形流光图 + 5+1 自适应皮肤'}</text>
    <rect x="36" y="58" width="102" height="36" rx="8" fill="#112a46" stroke="#38bdf8"/>
    <text x="87" y="81" text-anchor="middle" fill="#e0f2fe" font-size="12" font-weight="600">\${IS_EN ? 'Step 1 Plan' : '步骤 1 · 拆解'}</text>
    <path d="M 138 76 L 178 76" stroke="#38bdf8" stroke-width="2.5"/>
    <rect x="178" y="58" width="102" height="36" rx="8" fill="#0f2c27" stroke="#34d399"/>
    <text x="229" y="81" text-anchor="middle" fill="#a7f3d0" font-size="12" font-weight="600">\${IS_EN ? 'Step 2 Run' : '步骤 2 · 执行'}</text>
    <path d="M 280 76 L 320 76" stroke="#34d399" stroke-width="2.5"/>
    <rect x="320" y="58" width="66" height="36" rx="8" fill="#1b2640" stroke="#a78bfa"/>
    <text x="353" y="81" text-anchor="middle" fill="#ddd6fe" font-size="12" font-weight="600">\${IS_EN ? 'QA' : '核验'}</text>
    <circle cx="\${flowX.toFixed(1)}" cy="76" r="5" fill="#67e8f9"/>
    <rect x="36" y="110" width="350" height="36" rx="8" fill="#0d172a" stroke="#24385c"/>
    <circle cx="52" cy="128" r="7" fill="#38bdf8"/>
    <circle cx="72" cy="128" r="7" fill="#f59e0b"/>
    <circle cx="92" cy="128" r="7" fill="#34d399"/>
    <circle cx="112" cy="128" r="7" fill="#a78bfa"/>
    <text x="128" y="132" fill="#cbd5e1" font-size="11">\${IS_EN ? 'DIY Studio: 4 swatches -> dark/light + AI' : 'DIY 工坊：4 色推导双模 · 25MB 壁纸 · AI'}</text>

    <rect x="422" y="14" width="380" height="148" rx="12" fill="#141832" stroke="#a78bfa" stroke-width="1.8"/>
    <text x="440" y="42" fill="#ddd6fe" font-size="14.5" font-weight="700">\${IS_EN ? 'Chief-Only Memory Studio (0B @lead)' : '参谋专属记忆星图与外部桥 (0B 隔离)'}</text>
    <circle cx="496" cy="96" r="14" fill="#1e293b" stroke="#a78bfa" stroke-width="2"/>
    <circle cx="496" cy="96" r="5" fill="#c4b5fd" opacity="\${starPulse}"/>
    <line x1="510" y1="92" x2="572" y2="74" stroke="#7c3aed" stroke-width="1.6"/>
    <line x1="509" y1="103" x2="574" y2="122" stroke="#38bdf8" stroke-width="1.6"/>
    <circle cx="578" cy="72" r="7.5" fill="#38bdf8"/>
    <circle cx="580" cy="124" r="7.5" fill="#34d399"/>
    <rect x="602" y="57" width="186" height="30" rx="6" fill="#1e2444" stroke="#6366f1"/>
    <text x="695" y="76" text-anchor="middle" fill="#e0e7ff" font-size="10.5">MEMORY.md · USER_PROFILE</text>
    <rect x="602" y="96" width="186" height="30" rx="6" fill="#132b3d" stroke="#38bdf8"/>
    <text x="695" y="115" text-anchor="middle" fill="#bae6fd" font-size="10.5">mcp-http / Obsidian / Cordis</text>

    <rect x="18" y="176" width="784" height="102" rx="12" fill="#0f212c" stroke="#34d399" stroke-width="1.8"/>
    <text x="40" y="206" fill="#6ee7b7" font-size="15" font-weight="700">\${IS_EN ? 'Collaboration 2.0 + Preset Pack v2 + 21 Live-QA Fixes' : '协同系统 2.0 + 安全预设包 v2 + 3 轮真机沙盒 21 项清零'}</text>
    <text x="40" y="232" fill="#cbd5e1" font-size="12.5">\${IS_EN ? 'Discovers Codex / Claude / Gemini CLI with redacted live stream &amp; 2-hop relay' : '自动探测 Codex / Claude / Gemini CLI · 脱敏实时流 · 2 棒链式接力 · 左上角真 Star 同步'}</text>
    <text x="40" y="257" fill="#94a3b8" font-size="12">\${IS_EN ? 'Custom Chief naming &amp; Memory Studio stay 0-byte isolated from @lead main chat' : '全局自定义参谋昵称 · 开箱防泄密防误删防线 · 严格对 @lead 主对话保持 0 字节零打扰'}</text>
  </svg>\`;
}

function svgScene8(u) {
  const wave = (u * 2.5) % 1;
  const r1 = 22 + wave * 24;
  const op1 = (1 - wave).toFixed(2);
  const pulse = (Math.sin(u * Math.PI * 4) * 0.5 + 0.5).toFixed(2);
  return \`<svg viewBox="0 0 820 292" width="820" height="292" xmlns="http://www.w3.org/2000/svg">
    <rect x="18" y="14" width="384" height="190" rx="12" fill="#191324" stroke="#fb7185" stroke-width="2"/>
    <text x="38" y="42" fill="#fda4af" font-size="15" font-weight="700">\${IS_EN ? 'Voice Chief &amp; Inline Stage (Alt+V)' : '双模语音参谋长 &amp; 行内语音舞台'}</text>
    <circle cx="72" cy="96" r="22" fill="#2c1626" stroke="#fb7185" stroke-width="2"/>
    <circle cx="72" cy="96" r="\${r1.toFixed(1)}" fill="none" stroke="#fb7185" stroke-width="2" opacity="\${op1}"/>
    <text x="72" y="102" text-anchor="middle" fill="#ffe4e6" font-size="15">🔊</text>
    <rect x="112" y="64" width="276" height="60" rx="8" fill="#261320" stroke="#f43f5e"/>
    <text x="124" y="87" fill="#fecdd3" font-size="12" font-weight="700">\${IS_EN ? 'Boss! @worker-2 tried rm -rf - held!' : '老板不好啦，@worker-2 造反已被按住！'}</text>
    <text x="124" y="109" fill="#fda4af" font-size="10.5">\${IS_EN ? 'Scrubbed TTS + Dual ASR · Name Wake' : 'DS/OpenAI/离线 TTS · 双通道 ASR · 喊名唤醒'}</text>
    <rect x="34" y="148" width="354" height="38" rx="8" fill="#112438" stroke="#38bdf8"/>
    <text x="46" y="172" fill="#bae6fd" font-size="11.5" font-weight="600">\${IS_EN ? 'Strict L0-L3 dispatch guard + Archives -> Voice Notes' : '语音发令走 L0-L3 硬门禁不放空炮 · 唠嗑进「档案 -> 手记」'}</text>

    <rect x="418" y="14" width="384" height="190" rx="12" fill="#0f232e" stroke="#38bdf8" stroke-width="2"/>
    <text x="438" y="42" fill="#7dd3fc" font-size="15" font-weight="700">\${IS_EN ? '6-Channel Mobile Pager &amp; BM25 Vaults' : '6 通道手机传呼 &amp; 档案 / 向量 / 主题'}</text>
    <rect x="438" y="58" width="344" height="44" rx="8" fill="#102d3d" stroke="#22d3ee"/>
    <text x="452" y="85" fill="#cffafe" font-size="12" font-weight="700">\${IS_EN ? '📲 Feishu · DingTalk · WeCom · TG · Discord · Hook' : '📲 飞书 · 钉钉 · 企微 · TG · Discord · Webhook'}</text>
    <rect x="438" y="112" width="344" height="36" rx="8" fill="#122822" stroke="#34d399"/>
    <text x="452" y="135" fill="#a7f3d0" font-size="12">\${IS_EN ? 'CJK+Latin BM25 · 5-Rev Rollback · [[WikiLinks]]' : '双语 BM25 搜正文 · 5 版回滚 · [[双链]] 作废预警'}</text>
    <rect x="438" y="156" width="344" height="34" rx="8" fill="#1b1c3a" stroke="#a78bfa"/>
    <text x="452" y="177" fill="#ddd6fe" font-size="11.5">\${IS_EN ? 'OpenAI/Ollama/Gemini Vector · Theme Studio + Server Sync' : '三协议向量 · 主题工坊 / 社区皮肤 + 服务端多端同步'}</text>

    <rect x="18" y="218" width="784" height="62" rx="12" fill="#0b2821" stroke="#34d399" stroke-width="2.2"/>
    <circle cx="48" cy="249" r="7" fill="#34d399" opacity="\${pulse}"/>
    <text x="68" y="244" fill="#6ee7b7" font-size="14.5" font-weight="700">\${IS_EN ? 'dsh-chief v2.0.0 — Ready at Desk &amp; Away From Keyboard' : 'dsh-chief v2.0.0 — 平时不打扰 · 出事会喊你 · 离桌发手机 · 零外部依赖'}</text>
    <text x="68" y="266" fill="#d1fae5" font-size="12">\${IS_EN ? '53 backend (9 safety kernel) + 48 frontend modules · 27 fail-closed routes · npm &amp; GitHub Release' : '53 后端 (9 安全内核) + 48 前端模块 · 27 条环回接口 · 全局安装 dsh plugin --profile desktop add dsh-chief'}</text>
  </svg>\`;
}

const RENDERERS = [svgScene1, svgScene2, svgScene3, svgScene4, svgScene5, svgScene6, svgScene7, svgScene8];

function renderNodes(sIdx) {
  const wrap = document.getElementById('nodes');
  wrap.innerHTML = MILES.map((m, i) => {
    const cls = i < sIdx ? 'done' : i === sIdx ? 'curr' : 'todo';
    return \`<div class="node \${cls}">
      <div class="dotwrap"><span class="ndot">\${i < sIdx ? '✓' : i + 1}</span></div>
      <div class="nver">\${m.ver}</div>
      <div class="nlab">\${m.label}</div>
    </div>\`;
  }).join('');
}

window.__renderFrame = function(frameIdx) {
  const entry = FRAME_MAP[frameIdx];
  const { sc, sIdx, f, n } = entry;
  const u = f / (n - 1);

  const chip = document.getElementById('chip');
  chip.className = 'chip ' + sc.tone;
  chip.textContent = sc.chip;

  const h1 = document.getElementById('h1');
  const h2 = document.getElementById('h2');
  h1.textContent = sc.title;
  h2.textContent = sc.sub;

  const hero = document.getElementById('hero');
  hero.style.opacity = f < 5 ? (0.25 + 0.75 * easeOutCubic(f / 4)).toFixed(3) : '1';

  document.getElementById('stage').innerHTML = RENDERERS[sIdx](u);

  const denom = Math.max(1, MILES.length - 1);
  const prevPct = sIdx === 0 ? 0 : ((sIdx - 1) / denom) * 100;
  const targetPct = (sIdx / denom) * 100;
  const lineT = f < 10 ? easeOutCubic(f / 9) : 1;
  document.getElementById('fill').style.width = lerp(prevPct, targetPct, lineT).toFixed(2) + '%';
  renderNodes(sIdx);
  return frameIdx;
};

window.__renderFrame(0);
</script>
</body></html>`
}

class CdpClient {
  constructor(wsUrl) {
    this.ws = new WebSocket(wsUrl)
    this.seq = 0
    this.pending = new Map()
    this.waitReady = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', () => resolve(), { once: true })
      this.ws.addEventListener('error', (err) => reject(err.error ?? new Error('CDP WebSocket error')), { once: true })
    })
    this.ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(typeof ev.data === 'string' ? ev.data : Buffer.from(ev.data).toString('utf8'))
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        if (msg.error) reject(new Error(msg.error.message || JSON.stringify(msg.error)))
        else resolve(msg.result)
      }
    })
  }
  async send(method, params = {}) {
    await this.waitReady
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  close() {
    try {
      this.ws.close()
    } catch {}
  }
}

async function launchChromeCdp(profileDir, stageHtmlPath) {
  fs.mkdirSync(profileDir, { recursive: true })
  const stageUrl = 'file:///' + stageHtmlPath.replace(/\\/g, '/')
  const child = spawn(
    CHROME,
    [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--no-sandbox',
      '--disable-background-timer-throttling',
      '--force-device-scale-factor=1',
      `--window-size=${W},${H}`,
      '--remote-debugging-port=0',
      `--user-data-dir=${profileDir}`,
      stageUrl,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] }
  )

  const port = await new Promise((resolve, reject) => {
    let logs = ''
    const timer = setTimeout(() => {
      reject(new Error(`Chrome CDP startup timeout:\n${logs}`))
    }, 15000)

    const onChunk = (chunk) => {
      logs += chunk.toString('utf8')
      const m = logs.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//)
      if (m) {
        clearTimeout(timer)
        resolve(Number(m[1]))
      }
    }
    child.stderr.on('data', onChunk)
    child.stdout.on('data', onChunk)
    child.once('exit', (code) => {
      clearTimeout(timer)
      reject(new Error(`Chrome exited prematurely (${code}):\n${logs}`))
    })
  })

  let targetWs = null
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/list`)
      const list = await res.json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) {
        targetWs = page.webSocketDebuggerUrl
        break
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 50))
  }
  if (!targetWs) throw new Error(`No inspectable page target on CDP port ${port}`)

  const cdp = new CdpClient(targetWs)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: W,
    height: H,
    deviceScaleFactor: 1,
    mobile: false,
  })

  for (let attempt = 0; attempt < 40; attempt++) {
    const r = await cdp.send('Runtime.evaluate', {
      expression: 'typeof window.__renderFrame === "function" && window.__TOTAL_FRAMES',
      returnByValue: true,
    })
    if (r?.result?.value) break
    await new Promise((r2) => setTimeout(r2, 50))
  }

  return { child, cdp }
}

async function generateGif(lang, keepSamplesDir) {
  const outGif = path.join(ROOT, 'assets', lang === 'en' ? 'evolution-roadmap-en.gif' : 'evolution-roadmap.gif')
  const tmpDir = path.join(HERE, `.frames-evo-${lang}`)
  const profileDir = path.join(tmpDir, 'chrome-profile')
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(tmpDir, { recursive: true })
  fs.mkdirSync(path.dirname(outGif), { recursive: true })

  const stageHtml = path.join(tmpDir, 'stage.html')
  fs.writeFileSync(stageHtml, buildStageHtml(lang), 'utf8')

  const { child, cdp } = await launchChromeCdp(profileDir, stageHtml)
  const framePaths = []
  let sampleIndices = []
  try {
    const meta = await cdp.send('Runtime.evaluate', {
      expression: '({ total: window.__TOTAL_FRAMES, samples: window.__SAMPLE_INDICES })',
      returnByValue: true,
    })
    const total = meta.result.value.total
    sampleIndices = meta.result.value.samples

    for (let i = 0; i < total; i++) {
      await cdp.send('Runtime.evaluate', {
        expression: `window.__renderFrame(${i})`,
        returnByValue: true,
      })
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const p = path.join(tmpDir, `f${String(i).padStart(3, '0')}.png`)
      fs.writeFileSync(p, Buffer.from(shot.data, 'base64'))
      framePaths.push(p)
    }
  } finally {
    cdp.close()
    await new Promise((resolve) => {
      const done = () => resolve()
      child.once('exit', done)
      try {
        child.kill('SIGTERM')
      } catch {}
      setTimeout(() => {
        try {
          child.kill('SIGKILL')
        } catch {}
        resolve()
      }, 1500)
    })
  }

  if (keepSamplesDir) {
    fs.mkdirSync(keepSamplesDir, { recursive: true })
    sampleIndices.forEach((fIdx, sIdx) => {
      fs.copyFileSync(framePaths[fIdx], path.join(keepSamplesDir, `${lang}-s${sIdx + 1}.png`))
    })
  }

  const manifestPath = path.join(tmpDir, 'manifest.json')
  const pyPath = path.join(tmpDir, 'encode.py')
  fs.writeFileSync(
    manifestPath,
    JSON.stringify({
      outGif,
      maxBytes: MAX_BYTES,
      delayMs: FPS_DELAY,
      sampleIndices,
      framePaths,
      keepSamplesDir: keepSamplesDir || null,
      lang,
    }),
    'utf8'
  )

  fs.writeFileSync(
    pyPath,
    [
      'import json, os, sys',
      'from PIL import Image, ImageChops',
      '',
      'with open(sys.argv[1], "r", encoding="utf-8") as f:',
      '    m = json.load(f)',
      '',
      'frame_paths = m["framePaths"]',
      'sample_indices = m["sampleIndices"]',
      'delay_ms = int(m["delayMs"])',
      'out_gif = m["outGif"]',
      'max_bytes = int(m["maxBytes"])',
      '',
      'def encode_with_colors(max_colors):',
      '    samples = [Image.open(frame_paths[i]).convert("RGB") for i in sample_indices]',
      '    w, h = samples[0].size',
      '    strip = Image.new("RGB", (w, h * len(samples)))',
      '    for i, im in enumerate(samples):',
      '        strip.paste(im, (0, i * h))',
      '    p_sub = strip.quantize(colors=max_colors, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)',
      '    raw_pal = list(p_sub.getpalette() or [])[:max_colors * 3]',
      '    if len(raw_pal) < max_colors * 3:',
      '        raw_pal += [0] * (max_colors * 3 - len(raw_pal))',
      '    # Find nearest color index in [0..max_colors-1] for sentinel magenta (255,0,255)',
      '    fallback_idx = 0',
      '    best_d = 1 << 30',
      '    for ci in range(max_colors):',
      '        dr = raw_pal[ci*3] - 255',
      '        dg = raw_pal[ci*3+1]',
      '        db = raw_pal[ci*3+2] - 255',
      '        d = dr*dr + dg*dg + db*db',
      '        if d < best_d:',
      '            best_d = d',
      '            fallback_idx = ci',
      '    pad_count = 255 - max_colors',
      '    pal_bytes = raw_pal + ([raw_pal[0], raw_pal[1], raw_pal[2]] * pad_count) + [255, 0, 255]',
      '    pal_img = Image.new("P", (1, 1))',
      '    pal_img.putpalette(pal_bytes)',
      '    remap_lut = [fallback_idx if i == 255 else i for i in range(256)]',
      '',
      '    q_refs = []',
      '    delta_frames = []',
      '    prev_L = None',
      '    for idx, p in enumerate(frame_paths):',
      '        rgb = Image.open(p).convert("RGB")',
      '        q = rgb.quantize(palette=pal_img, dither=Image.Dither.NONE).point(remap_lut)',
      '        q.putpalette(pal_bytes)',
      '        q_refs.append(q)',
      '        curr_L = Image.frombytes("L", q.size, q.tobytes())',
      '        if idx == 0:',
      '            delta_frames.append(q.copy())',
      '        else:',
      '            diff = ImageChops.difference(curr_L, prev_L)',
      '            mask_same = diff.point(lambda v: 255 if v == 0 else 0, mode="1")',
      '            delta = q.copy()',
      '            delta.paste(255, mask=mask_same)',
      '            delta.putpalette(pal_bytes)',
      '            delta_frames.append(delta)',
      '        prev_L = curr_L',
      '',
      '    delta_frames[0].save(',
      '        out_gif,',
      '        save_all=True,',
      '        append_images=delta_frames[1:],',
      '        duration=delay_ms,',
      '        loop=0,',
      '        disposal=1,',
      '        transparency=255,',
      '        optimize=True,',
      '    )',
      '    return q_refs',
      '',
      'q_refs = encode_with_colors(255)',
      'size = os.path.getsize(out_gif)',
      'if size > max_bytes:',
      '    q_refs = encode_with_colors(192)',
      '    size = os.path.getsize(out_gif)',
      '',
      '# Strict zero-ghosting verification by full forward composite decode',
      'g = Image.open(out_gif)',
      'if g.n_frames != len(frame_paths):',
      '    raise RuntimeError(f"Frame count mismatch: expected {len(frame_paths)}, got {g.n_frames}")',
      'total_ms = 0',
      'max_diff = 0',
      'sample_set = set(sample_indices)',
      'for i in range(g.n_frames):',
      '    g.seek(i)',
      '    d_cur = int(g.info.get("duration", 0))',
      '    src_idx = min(len(q_refs) - 1, total_ms // delay_ms)',
      '    total_ms += d_cur',
      '    if src_idx in sample_set or i == g.n_frames - 1:',
      '        dec_rgb = g.convert("RGB")',
      '        ref_rgb = q_refs[src_idx].convert("RGB")',
      '        d_im = ImageChops.difference(dec_rgb, ref_rgb)',
      '        ext = d_im.getextrema()',
      '        fd = max(hi for (_, hi) in ext)',
      '        if fd > max_diff:',
      '            max_diff = fd',
      '        if m.get("keepSamplesDir") and src_idx in sample_set:',
      '            s_num = sample_indices.index(src_idx) + 1',
      '            dec_rgb.save(os.path.join(m["keepSamplesDir"], f"gif-{m[\'lang\']}-s{s_num}.png"))',
      '',
      'expected_ms = len(frame_paths) * delay_ms',
      'if total_ms != expected_ms:',
      '    raise RuntimeError(f"Duration mismatch: expected {expected_ms}, got {total_ms}")',
      'if max_diff != 0:',
      '    raise RuntimeError(f"Ghosting/quantization mismatch detected: max_diff={max_diff}")',
      'print(json.dumps({"n_frames": g.n_frames, "total_ms": total_ms, "bytes": size, "max_diff": max_diff}))',
    ].join('\n'),
    'utf8'
  )

  const pyOut = execFileSync(PYTHON, [pyPath, manifestPath], { encoding: 'utf8' }).trim()
  const stats = JSON.parse(pyOut.split(/\r?\n/).pop())
  fs.rmSync(tmpDir, { recursive: true, force: true })

  console.log(
    `${path.relative(ROOT, outGif)}  ${W}x${H}  ${stats.n_frames} frames  ${(stats.total_ms / 1000).toFixed(1)}s loop  ${(stats.bytes / 1024).toFixed(1)} KB  decode_verify=OK (max_diff=${stats.max_diff})`
  )
  if (stats.bytes > MAX_BYTES) {
    throw new Error(`GIF ${outGif} exceeds ${(MAX_BYTES / 1024).toFixed(0)} KB budget (${stats.bytes} bytes)`)
  }
}

async function main() {
  const args = process.argv.slice(2)
  let langFilter = null
  let keepSamplesDir = null
  for (const arg of args) {
    if (arg.startsWith('--lang=')) langFilter = arg.slice('--lang='.length)
    else if (arg.startsWith('--keep-samples=')) keepSamplesDir = arg.slice('--keep-samples='.length)
  }

  const langs = langFilter ? [langFilter] : ['zh', 'en']
  for (const l of langs) {
    if (!SCENES[l]) throw new Error(`Unsupported lang: ${l}`)
    await generateGif(l, keepSamplesDir)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
