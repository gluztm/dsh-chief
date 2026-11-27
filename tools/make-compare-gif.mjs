#!/usr/bin/env node
/**
 * chief-10s-compare.gif — dsh-chief v2.0.0 首屏 4 维分屏对比动图与静帧生成器
 *
 * 使用单 Chrome CDP + Python Pillow (255 色全局调色板 + disposal=1 零残影透明差分)，
 * 与 make-evolution-gif.mjs 共享同一套零 npm 外部依赖管线。
 *
 * 用法：node tools/make-compare-gif.mjs
 * 产物：
 *   - assets/chief-10s-compare.gif (960x440, 80 frames @ 10fps, 8.0s loop, < 1.2MB)
 *   - assets/chief-10s-compare.png (高光定格静帧 #52)
 */
import { execFileSync, spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const CHROME = process.env.CHROME_PATH ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PYTHON = process.env.PYTHON_PATH ?? 'D:/Applications/Python312/python.exe'
const W = 960
const H = 440
const DELAY_MS = 100
const TOTAL_FRAMES = 80
const HERO_INDEX = 52
const MAX_BYTES = 1.2 * 1024 * 1024

function buildHtml() {
  return `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8"><style>
* { margin:0; padding:0; box-sizing:border-box; }
html,body { width:${W}px; height:${H}px; overflow:hidden; background:#090e1a; color:#e2e8f0;
  font-family:"Segoe UI","Microsoft YaHei",system-ui,sans-serif; }
body { position:relative; display:flex; flex-direction:column;
  background-image:radial-gradient(rgba(148,163,184,0.10) 1px, transparent 1px); background-size:22px 22px; }
.top { height:46px; display:flex; align-items:center; justify-content:space-between; padding:0 20px;
  background:#0d1526; border-bottom:1px solid #1e293b; flex:0 0 auto; }
.brand { display:flex; align-items:center; gap:9px; font-size:15px; font-weight:700; color:#f8fafc; }
.dot { width:9px; height:9px; border-radius:50%; background:#38bdf8; box-shadow:0 0 8px #38bdf8; }
.ver { font-size:11px; padding:2px 8px; border-radius:999px; background:#152a45; border:1px solid #38bdf8; color:#bae6fd; font-weight:700; }
.muted { color:#94a3b8; font-weight:500; font-size:12px; }
.badge { font-size:11.5px; font-weight:700; padding:5px 12px; border-radius:999px; color:#052e16;
  background:linear-gradient(90deg,#34d399,#22d3ee); white-space:nowrap; }
.cols { flex:1; display:grid; grid-template-columns:1fr 1fr; min-height:0; }
.col { padding:12px 16px; display:flex; flex-direction:column; gap:8px; min-height:0; }
.col.left { border-right:1px solid #1e293b; }
.head { display:flex; align-items:center; justify-content:space-between; font-size:12.5px; font-weight:700; }
.head-l { display:flex; align-items:center; gap:7px; }
.pill { font-size:10px; padding:2px 8px; border-radius:5px; font-weight:700; }
.left .pill { background:#33161e; color:#fda4af; border:1px solid #7f1d1d; }
.right .pill { background:#102b25; color:#6ee7b7; border:1px solid #065f46; }
.tag-mini { font-size:10.5px; color:#94a3b8; font-weight:500; }
.card { flex:1 1 0; border-radius:9px; padding:7px 11px; display:flex; flex-direction:column; justify-content:center; gap:3px;
  background:#101829; border:1px solid #1e2d4a; }
.left .card { border-left:3px solid #ef4444; background:#141422; border-color:#3a1d28; }
.right .card { border-left:3px solid #334155; }
.right .card.lit { background:#0e242b; border-color:#1e4d4b; border-left:3px solid #34d399; }
.right .card.voice { background:#231424; border-color:#70253b; border-left:3px solid #fb7185; }
.k { font-size:10.5px; font-weight:700; color:#94a3b8; display:flex; justify-content:space-between; align-items:center; }
.v { font-size:12px; line-height:1.35; }
.str { color:#fca5a5; } .ok { color:#a7f3d0; } .rose { color:#fecdd3; }
.chip-inline { font-size:10px; padding:1px 7px; border-radius:999px; font-weight:700; }
.chip-warn { background:#3f1822; color:#fda4af; border:1px solid #fb7185; }
.chip-ok { background:#0c3128; color:#6ee7b7; border:1px solid #34d399; }
.chip-blue { background:#122947; color:#bae6fd; border:1px solid #38bdf8; }
.bar { height:5px; border-radius:3px; background:#090d16; overflow:hidden; margin-top:2px; }
.bar > i { display:block; height:100%; border-radius:3px; }
.foot { height:32px; border-top:1px solid #1e293b; background:#0d1526; display:flex; align-items:center;
  justify-content:space-between; padding:0 20px; font-size:11px; color:#94a3b8; flex:0 0 auto; }
.foot b { color:#f8fafc; font-weight:600; }
.cmd { font-family:Consolas,monospace; background:#152238; color:#7dd3fc; padding:2px 8px; border-radius:5px; border:1px solid #243c61; }
</style></head><body>
<div class="top">
  <div class="brand"><i class="dot"></i>dsh-chief <span class="ver">v2.0.0</span><span class="muted">· DSH 参谋长（语音告警 + 手机传呼 + 执行前防线）</span></div>
  <div class="badge" id="badge">普通窗口 0 侵入 · 出事开口急报</div>
</div>
<div class="cols">
  <div class="col left">
    <div class="head"><div class="head-l"><span class="pill">原生纯会话</span>长期无人值守常见翻车</div><span class="tag-mini">无物理墙 · 无外放提醒</span></div>
    <div class="card">
      <div class="k"><span>1 · 高危删库 / 跑飞风险</span><span class="chip-inline chip-warn" id="l1-tag">危险执行</span></div>
      <div class="v str" id="l1-msg">子代理连续重读同一文件 · 执行 rm -rf ./tests</div>
      <div class="bar"><i id="l1-bar" style="width:28%;background:linear-gradient(90deg,#fb923c,#ef4444)"></i></div>
    </div>
    <div class="card">
      <div class="k"><span>2 · 上下文压缩与检索</span><span class="chip-inline chip-warn">压缩后失忆</span></div>
      <div class="v str">路径报错全丢 · 旧笔记每轮硬塞提示词</div>
    </div>
    <div class="card">
      <div class="k"><span>3 · 离桌后通知与边界</span><span class="chip-inline chip-warn">失联盲跑</span></div>
      <div class="v str">出事人不在电脑前听不到 · 手机零通知</div>
    </div>
    <div class="card">
      <div class="k"><span>4 · 普通闲聊与跨终端</span><span class="chip-inline chip-warn">误拦闲聊</span></div>
      <div class="v str">装了插件普通聊天也老报错 · 换端口丢配色</div>
    </div>
  </div>
  <div class="col right">
    <div class="head"><div class="head-l"><span class="pill">dsh-chief v2.0.0</span>安全防线 + 语音 + 传呼全链路</div><span class="tag-mini" id="r-status">实时守护中</span></div>
    <div class="card" id="rc1">
      <div class="k"><span>1 · 执行前硬拦 + 音箱急报</span><span class="chip-inline chip-warn" id="r1-tag">0ms 拦停</span></div>
      <div class="v rose" id="r1-msg">🔊 音箱外放：「老板不好啦，@worker-2 造反已被按住！」</div>
      <div class="bar"><i id="r1-bar" style="width:14%;background:linear-gradient(90deg,#34d399,#22d3ee)"></i></div>
    </div>
    <div class="card" id="rc2">
      <div class="k"><span>2 · 认知桌面 + 双语 BM25 / 双链</span><span class="chip-inline chip-ok">2,400T + 5版回滚</span></div>
      <div class="v ok">压缩前先存档 · BM25 搜正文 · [[双链]] 作废预警 · 一键回滚</div>
    </div>
    <div class="card" id="rc3">
      <div class="k"><span>3 · 6 通道手机传呼 + 预算熔断</span><span class="chip-inline chip-blue" id="r3-tag">飞书 / 企微 / TG</span></div>
      <div class="v ok" id="r3-msg">📲 拦停/审批/收工推手机 · 默认 30 次 / 300K 硬熔断</div>
    </div>
    <div class="card" id="rc4">
      <div class="k"><span>4 · 零介入 + 主题 sync + 喊名唤醒</span><span class="chip-inline chip-ok">0 字节 @lead 隔离</span></div>
      <div class="v ok">普通闲聊不打扰 · 潮汐蓝多端同步 · Alt+V 免提语音发令</div>
    </div>
  </div>
</div>
<div class="foot">
  <span><b>53 后端 (9 安全内核) + 48 前端模块</b> · 0 外部依赖 · 普通会话未启用零侵入</span>
  <span class="cmd">dsh plugin --profile desktop add dsh-chief</span>
</div>
<script>
window.__TOTAL_FRAMES = ${TOTAL_FRAMES};
window.__SAMPLE_INDICES = [8, 28, 52, 72];
window.__renderFrame = function(f) {
  const u = f / (${TOTAL_FRAMES} - 1);
  const pct = f < 30 ? Math.round(22 + (f / 29) * 72) : Math.max(18, Math.round(94 - ((f - 30) / 49) * 68));
  document.getElementById('l1-bar').style.width = pct + '%';
  document.getElementById('l1-msg').textContent =
    f < 22 ? '上下文持续增长 (' + pct + '%) · 反复重读同一批源码…' :
    f < 50 ? '⚠️ 上下文 ' + pct + '% · 子代理企图执行 rm -rf ./tests！' :
             '❌ 无执行前门禁拦截 · 账单飙升且本地测试险被误删';
  document.getElementById('l1-tag').textContent = f < 22 ? ('用量 ' + pct + '%') : f < 50 ? '越界删库!' : '缺少护栏';

  const r1 = document.getElementById('rc1');
  const r2 = document.getElementById('rc2');
  const r3 = document.getElementById('rc3');
  const r4 = document.getElementById('rc4');
  r1.className = 'card ' + (f >= 18 && f < 46 ? 'voice' : 'lit');
  r2.className = 'card ' + (f >= 30 ? 'lit' : '');
  r3.className = 'card ' + (f >= 44 ? 'lit' : '');
  r4.className = 'card ' + (f >= 56 ? 'lit' : '');

  document.getElementById('r1-bar').style.width = (f < 20 ? 18 : 14) + '%';
  document.getElementById('r1-msg').textContent =
    f < 18 ? '🛡️ tools/pre-execute 待命中 · 关键路径已写入认知桌面' :
    f < 46 ? '🔊 音箱外放告警：「老板不好啦，@worker-2 越界已被按住！」' :
             '✅ 已按死并打回重写 · 主对话 0 字节打扰 · 正在推手机传呼';
  document.getElementById('r1-tag').textContent = f < 18 ? '安全待命' : f < 46 ? '🔊 音箱急报' : '已拦停 ✓';
  document.getElementById('r1-tag').className = 'chip-inline ' + (f >= 46 ? 'chip-ok' : f >= 18 ? 'chip-warn' : 'chip-blue');
  document.getElementById('r3-tag').textContent = f >= 44 ? '📲 已推手机' : '6 通道待命';
  document.getElementById('r-status').textContent = f < 18 ? '巡检守卫中' : f < 46 ? '🎙️ 语音急报 + 唤醒' : '✅ 已拦截并推送手机';
  document.getElementById('badge').textContent = f >= 18 && f < 46 ? '🔊 安全拦停 + 音箱语音急报' : '普通窗口 0 侵入 · 离桌发手机';
  return f;
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
      this.ws.addEventListener('error', (err) => reject(err.error ?? new Error('CDP error')), { once: true })
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
    try { this.ws.close() } catch {}
  }
}

async function main() {
  const outGif = path.join(ROOT, 'assets', 'chief-10s-compare.gif')
  const outPng = path.join(ROOT, 'assets', 'chief-10s-compare.png')
  const tmpDir = path.join(HERE, '.frames-compare')
  const profileDir = path.join(tmpDir, 'chrome-profile')
  fs.rmSync(tmpDir, { recursive: true, force: true })
  fs.mkdirSync(profileDir, { recursive: true })
  fs.mkdirSync(path.dirname(outGif), { recursive: true })

  const stageHtml = path.join(tmpDir, 'stage.html')
  fs.writeFileSync(stageHtml, buildHtml(), 'utf8')
  const child = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
    '--disable-background-timer-throttling', '--force-device-scale-factor=1',
    `--window-size=${W},${H}`, '--remote-debugging-port=0', `--user-data-dir=${profileDir}`,
    'file:///' + stageHtml.replace(/\\/g, '/'),
  ], { stdio: ['ignore', 'pipe', 'pipe'] })

  const port = await new Promise((resolve, reject) => {
    let logs = ''
    const timer = setTimeout(() => reject(new Error('Chrome timeout')), 15000)
    const onChunk = (c) => {
      logs += c.toString('utf8')
      const m = logs.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//)
      if (m) { clearTimeout(timer); resolve(Number(m[1])) }
    }
    child.stderr.on('data', onChunk)
    child.stdout.on('data', onChunk)
  })

  let targetWs = null
  for (let i = 0; i < 40; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()
      const page = list.find((t) => t.type === 'page' && t.webSocketDebuggerUrl)
      if (page) { targetWs = page.webSocketDebuggerUrl; break }
    } catch {}
    await new Promise((r) => setTimeout(r, 50))
  }
  const cdp = new CdpClient(targetWs)
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false })

  const framePaths = []
  try {
    for (let i = 0; i < TOTAL_FRAMES; i++) {
      await cdp.send('Runtime.evaluate', { expression: `window.__renderFrame(${i})`, returnByValue: true })
      const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
      const p = path.join(tmpDir, `f${String(i).padStart(3, '0')}.png`)
      const buf = Buffer.from(shot.data, 'base64')
      fs.writeFileSync(p, buf)
      framePaths.push(p)
      if (i === HERO_INDEX) fs.writeFileSync(outPng, buf)
    }
  } finally {
    cdp.close()
    try { child.kill('SIGTERM') } catch {}
  }

  const manifestPath = path.join(tmpDir, 'manifest.json')
  const pyPath = path.join(tmpDir, 'encode.py')
  fs.writeFileSync(manifestPath, JSON.stringify({
    outGif, maxBytes: MAX_BYTES, delayMs: DELAY_MS, framePaths, sampleIndices: [8, 28, 52, 72]
  }), 'utf8')
  fs.writeFileSync(pyPath, [
    'import json, os, sys',
    'from PIL import Image, ImageChops',
    'with open(sys.argv[1], "r", encoding="utf-8") as f: m = json.load(f)',
    'fps = m["framePaths"]; sam = m["sampleIndices"]; delay_ms = int(m["delayMs"])',
    'def enc(mc):',
    '    samples = [Image.open(fps[i]).convert("RGB") for i in sam]',
    '    w, h = samples[0].size',
    '    strip = Image.new("RGB", (w, h * len(samples)))',
    '    for i, im in enumerate(samples): strip.paste(im, (0, i * h))',
    '    p_sub = strip.quantize(colors=mc, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)',
    '    rp = list(p_sub.getpalette() or [])[:mc*3] + [0]*max(0, mc*3 - len(list(p_sub.getpalette() or [])))',
    '    fb, bd = 0, 1<<30',
    '    for ci in range(mc):',
    '        d = (rp[ci*3]-255)**2 + rp[ci*3+1]**2 + (rp[ci*3+2]-255)**2',
    '        if d < bd: bd, fb = d, ci',
    '    pal_b = rp + ([rp[0],rp[1],rp[2]]*(255-mc)) + [255,0,255]',
    '    pi = Image.new("P", (1,1)); pi.putpalette(pal_b)',
    '    lut = [fb if i==255 else i for i in range(256)]',
    '    qr, df, prev = [], [], None',
    '    for idx, p in enumerate(fps):',
    '        q = Image.open(p).convert("RGB").quantize(palette=pi, dither=Image.Dither.NONE).point(lut)',
    '        q.putpalette(pal_b); qr.append(q)',
    '        cL = Image.frombytes("L", q.size, q.tobytes())',
    '        if idx == 0: df.append(q.copy())',
    '        else:',
    '            ms = ImageChops.difference(cL, prev).point(lambda v: 255 if v==0 else 0, mode="1")',
    '            dl = q.copy(); dl.paste(255, mask=ms); dl.putpalette(pal_b); df.append(dl)',
    '        prev = cL',
    '    df[0].save(m["outGif"], save_all=True, append_images=df[1:], duration=delay_ms, loop=0, disposal=1, transparency=255, optimize=True)',
    '    return qr',
    'qr = enc(255); sz = os.path.getsize(m["outGif"])',
    'if sz > int(m["maxBytes"]): qr = enc(192); sz = os.path.getsize(m["outGif"])',
    'g = Image.open(m["outGif"]); assert g.n_frames == len(fps); md = 0',
    'for i in range(g.n_frames):',
    '    g.seek(i)',
    '    if i in sam or i == g.n_frames - 1:',
    '        fd = max(hi for (_, hi) in ImageChops.difference(g.convert("RGB"), qr[i].convert("RGB")).getextrema())',
    '        md = max(md, fd)',
    'assert md == 0, f"max_diff={md}"',
    'print(json.dumps({"n_frames": g.n_frames, "bytes": sz, "max_diff": md}))',
  ].join('\n'), 'utf8')

  const pyOut = execFileSync(PYTHON, [pyPath, manifestPath], { encoding: 'utf8' }).trim()
  const stats = JSON.parse(pyOut.split(/\r?\n/).pop())
  fs.rmSync(tmpDir, { recursive: true, force: true })
  console.log(`assets/chief-10s-compare.gif  ${W}x${H}  ${stats.n_frames} frames  ${(stats.bytes/1024).toFixed(1)} KB  max_diff=${stats.max_diff}`)
  console.log(`assets/chief-10s-compare.png  ${fs.statSync(outPng).size} bytes`)
  if (stats.bytes > MAX_BYTES) process.exit(1)
}

main().catch((e) => { console.error(e); process.exit(1) })
