#!/usr/bin/env node
/**
 * chief-10s-compare.gif — 首屏分屏对比动图生成器
 *
 * 为什么是脚本而不是录屏：截图序列 + 纯 JS 合成 GIF 可复现、可改文案、无外部依赖，
 * 重录只要改下面的 FRAMES 文案再跑一次。不要在仓库里手改 GIF。
 *
 * 用法：node tools/make-compare-gif.mjs
 * 依赖：chrome（渲染帧）、gifenc + pngjs（合成 GIF，devDependency）
 * 产物：assets/chief-10s-compare.gif（800x450，循环，< 2MB）
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'
import { GIFEncoder, quantize, applyPalette } from 'gifenc/dist/gifenc.esm.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT_DIR = path.join(HERE, '.frames')
const OUT_GIF = path.join(ROOT, 'assets', 'chief-10s-compare.gif')

const W = 800
const H = 450
const FRAME_DELAY = 400
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'

function frame(state) {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:${W}px; height:${H}px; overflow:hidden; }
body { position:relative; display:flex; flex-direction:column; color:#e6edf7;
  font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif; background:#0b1220; }
.grid { position:absolute; inset:0; pointer-events:none; background-image:
  linear-gradient(rgba(120,160,220,.07) 1px, transparent 1px),
  linear-gradient(90deg, rgba(120,160,220,.07) 1px, transparent 1px);
  background-size:30px 30px; }
.top { position:relative; height:50px; display:flex; align-items:center; justify-content:space-between;
  padding:0 18px; border-bottom:1px solid rgba(120,160,220,.18); }
.brand { display:flex; align-items:center; gap:9px; font-size:15px; font-weight:700; letter-spacing:.3px; }
.dot { width:9px; height:9px; border-radius:50%; background:#38bdf8; box-shadow:0 0 10px #38bdf8; }
.brand .muted { color:#7d90ab; font-weight:500; font-size:12px; }
.badge { font-size:11.5px; font-weight:700; letter-spacing:.4px; padding:6px 12px; border-radius:999px;
  color:#08111e; background:linear-gradient(90deg,#34d399,#22d3ee); white-space:nowrap;
  box-shadow:0 0 18px rgba(52,211,153,${state.glow}); }
.cols { position:relative; flex:1; display:grid; grid-template-columns:1fr 1fr; min-height:0; }
.col { padding:13px 15px; display:flex; flex-direction:column; gap:8px; min-height:0; }
.col.left { border-right:1px solid rgba(120,160,220,.18); }
.head { display:flex; align-items:center; gap:7px; font-size:12.5px; font-weight:700; flex:0 0 auto; }
.pill { font-size:9.5px; padding:2px 7px; border-radius:5px; font-weight:700; letter-spacing:.3px; }
.left .pill { background:rgba(248,113,113,.16); color:#f87171; }
.right .pill { background:rgba(52,211,153,.16); color:#34d399; }
.card { flex:1 1 0; min-height:0; border-radius:9px; padding:7px 10px;
  display:flex; flex-direction:column; justify-content:center;
  background:rgba(255,255,255,.035); border:1px solid rgba(120,160,220,.16); }
.card .k { color:#7d90ab; font-size:10px; letter-spacing:.4px; margin-bottom:3px; }
.card .v { font-size:11.5px; line-height:1.45; }
.left .card { border-color:rgba(248,113,113,.22); }
.bar { height:4px; border-radius:3px; background:rgba(255,255,255,.08); overflow:hidden; margin-top:6px; }
.bar > i { display:block; height:100%; border-radius:3px;
  background:linear-gradient(90deg,#f87171,#fb923c); }
.col.right .card { border-color:rgba(120,160,220,.16); opacity:.42; }
.col.right .card.lit { border-color:rgba(52,211,153,.6); opacity:1;
  background:rgba(52,211,153,.075); }
.col.right .bar > i { background:linear-gradient(90deg,#34d399,#22d3ee); }
.str { color:#fca5a5; } .ok { color:#6ee7b7; }
.brk { margin-top:6px; align-self:flex-start; font-size:10px; font-weight:700; letter-spacing:.4px;
  padding:3px 9px; border-radius:6px; color:#08111e;
  background:linear-gradient(90deg,#fbbf24,#f97316);
  box-shadow:0 0 14px rgba(251,191,36,${state.pulse}); }
.foot { position:relative; height:32px; border-top:1px solid rgba(120,160,220,.18);
  display:flex; align-items:center; justify-content:center; font-size:10.5px; color:#7d90ab; }
.foot b { color:#e6edf7; font-weight:600; }
</style></head><body>
<div class="grid"></div>
<div class="top">
  <div class="brand"><i class="dot"></i>dsh-chief<span class="muted">· DSH 参谋长</span></div>
  <div class="badge">默认只读 · 零接管风险</div>
</div>
<div class="cols">
  <div class="col left">
    <div class="head"><span class="pill">原生</span>原生长会话</div>
    <div class="card"><div class="k">上下文用量</div><div class="v str">${state.leftMsg}</div>
      <div class="bar"><i style="width:${state.left}%"></i></div></div>
    <div class="card"><div class="k">压缩前</div><div class="v str">参数丢失 · 没落盘就被压掉</div></div>
    <div class="card"><div class="k">换窗口</div><div class="v str">记忆归零 · 从头解释</div></div>
    <div class="card"><div class="k">结果</div><div class="v str">${state.leftLast}</div></div>
  </div>
  <div class="col right">
    <div class="head"><span class="pill">参谋长</span>装上之后</div>
    <div class="card ${state.stage >= 0 ? 'lit' : ''}">
      <div class="k">死循环</div><div class="v ok">一键熔断 · 停止烧钱</div>
      ${state.pulse > .5 ? '<span class="brk">熔断中</span>' : ''}
      <div class="bar"><i style="width:${state.right}%"></i></div></div>
    <div class="card ${state.stage >= 1 ? 'lit' : ''}"><div class="k">压缩前</div><div class="v ok">参数先入柜 · 复核落盘再压</div></div>
    <div class="card ${state.stage >= 2 ? 'lit' : ''}"><div class="k">换窗口</div><div class="v ok">归档随取 · 零额度跨窗记忆</div></div>
    <div class="card ${state.stage >= 4 ? 'lit' : ''}"><div class="k">结果</div><div class="v ok">${state.rightLast}</div></div>
  </div>
</div>
<div class="foot">同一个窗口 · 同一份上下文 —— 差别只在有没有 <b>dsh plugin --profile web add dsh-chief</b></div>
</body></html>`
}

const FRAMES = [
  { left: 18, leftMsg: '刚开始 · 还算清爽', stage: -1, pulse: 0, right: 100, leftLast: '一切正常' },
  { left: 31, leftMsg: '同一个文件读第 2 遍', stage: -1, pulse: 0, right: 100, leftLast: '开始重复' },
  { left: 45, leftMsg: '同一份日志读第 4 遍', stage: -1, pulse: 0, right: 100, leftLast: '循环打转' },
  { left: 58, leftMsg: '同一个文件读第 6 遍', stage: -1, pulse: 0, right: 100, leftLast: '循环打转' },
  { left: 71, leftMsg: '同一段代码读第 9 遍', stage: -1, pulse: 0, right: 100, leftLast: '反复重读' },
  { left: 84, leftMsg: '上下文快满了 · 还在绕', stage: -1, pulse: 1, right: 100, leftLast: '跑飞' },
  { left: 94, leftMsg: '上下文 94% · 死循环', stage: 0, pulse: 1, right: 18, leftLast: '跑飞 · 账单在涨' },
  { left: 88, leftMsg: '熔断生效 · 停止重读', stage: 0, pulse: 0, right: 18, leftLast: '跑飞 · 账单在涨' },
  { left: 74, leftMsg: '熔断生效 · 停止重读', stage: 1, pulse: 0, right: 16, leftLast: '跑飞 · 账单在涨' },
  { left: 60, leftMsg: '参数已落盘 · 准备压缩', stage: 1, pulse: 0, right: 16, leftLast: '跑飞 · 账单在涨' },
  { left: 47, leftMsg: '参数已落盘 · 准备压缩', stage: 2, pulse: 0, right: 15, leftLast: '跑飞 · 账单在涨' },
  { left: 35, leftMsg: '压缩完成 · 关键结论都在', stage: 2, pulse: 0, right: 15, leftLast: '跑飞 · 账单在涨' },
  { left: 26, leftMsg: '压缩完成 · 关键结论都在', stage: 2, pulse: 0, right: 14, leftLast: '跑飞 · 账单在涨' },
  { left: 20, leftMsg: '换窗口 · 归档直接带过去', stage: 4, pulse: 0, right: 13, leftLast: '一键熔断 · 少烧一半' },
  { left: 20, leftMsg: '换窗口 · 归档直接带过去', stage: 4, pulse: 0, right: 12, leftLast: '一键熔断 · 少烧一半' },
  { left: 20, leftMsg: '换窗口 · 归档直接带过去', stage: 4, pulse: 1, right: 12, leftLast: '一键熔断 · 少烧一半' },
  { left: 20, leftMsg: '换窗口 · 归档直接带过去', stage: 4, pulse: 1, right: 12, leftLast: '一键熔断 · 少烧一半' },
  { left: 20, leftMsg: '换窗口 · 归档直接带过去', stage: 4, pulse: 1, right: 12, leftLast: '一键熔断 · 少烧一半' },
  { left: 20, leftMsg: '换窗口 · 归档直接带过去', stage: 4, pulse: 1, right: 12, leftLast: '一键熔断 · 少烧一半' },
  { left: 20, leftMsg: '换窗口 · 归档直接带过去', stage: 4, pulse: 1, right: 12, leftLast: '一键熔断 · 少烧一半' },
]

const RIGHT_LAST = '极简战报 · 长会话不跑飞'

fs.mkdirSync(OUT_DIR, { recursive: true })
fs.mkdirSync(path.dirname(OUT_GIF), { recursive: true })

const files = []
FRAMES.forEach((st, i) => {
  const merged = { ...st, rightLast: RIGHT_LAST, glow: '0.35' }
  const html = path.join(OUT_DIR, `f${String(i).padStart(2, '0')}.html`)
  const png = path.join(OUT_DIR, `f${String(i).padStart(2, '0')}.png`)
  fs.writeFileSync(html, frame(merged))
  execFileSync(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
    `--window-size=${W},${H}`, `--screenshot=${png}`, 'file:///' + html.replace(/\\/g, '/'),
  ], { stdio: 'ignore' })
  files.push(png)
  process.stdout.write(`frame ${i + 1}/${FRAMES.length}\r`)
})
console.log(`\nrendered ${files.length} frames`)

const raw = files.map((f) => PNG.sync.read(fs.readFileSync(f)).data)
const all = Buffer.concat(raw)
const palette = quantize(all, 256, { format: 'rgb565' })

const gif = GIFEncoder()
raw.forEach((px) => {
  gif.writeFrame(applyPalette(px, palette, 'rgb565'), W, H, { palette, delay: FRAME_DELAY })
})
gif.finish()
fs.writeFileSync(OUT_GIF, gif.bytes())

const size = fs.statSync(OUT_GIF).size
console.log(`${path.relative(ROOT, OUT_GIF)}  ${W}x${H}  ${files.length} frames  ${(size / 1024).toFixed(0)} KB`)
if (size > 2 * 1024 * 1024) {
  console.error('超过 2MB 上限，减少帧数或调色板位数')
  process.exit(1)
}
