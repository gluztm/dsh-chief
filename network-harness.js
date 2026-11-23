/**
 * network-harness.js — 本机外部 Harness (Claude/Codex 等) CLI 探测、协同水泡状态与物理隔离派发
 *
 * 【核心职责】
 *   1. 跨平台本机 CLI/配置自动探测（`detectLocalHarnessBinaries`、`discoverHarnessProviders`）
 *      及 `refreshBubbleDiscovery` 一键强制清缓存重扫。
 *   2. 协同水泡状态组装（`computeBubbleState`）与目标解析（`resolveExternalHarnessTarget`）。
 *   3. 外部进程物理隔离派发与红线防穿透（`dispatchBubbleHarness`）。
 *
 * 【边界与无环约定】
 *   - 作为 `chief-network.js` 的下层专属模块，不反向 `import './chief-network.js'`；
 *   - 通过 `registerPeerDirectoryReader(fn)` 在运行时注入同组会话目录读取器。
 *   - 本模块严禁引入 `child_process`，所有外部执行由调度层 / executor 沙箱通道完成。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  MAIL_CAP,
  CHAT_CAP,
  nextId,
  clamp,
  loadChiefState,
  mutateChiefState,
  appendChiefAuditLog,
  getLinkedCluster,
  ensureWorkspace,
  resolveWorkspaceConfig,
  OFFICIAL_HARNESS_CATALOG,
  setBubbleHarnessMembership,
} from './chief-state.js'
import { listGuardWalls } from './chief-executor.js'

let peerDirectoryReader = null

/** Register peer directory reader from chief-network.js without introducing a circular ESM import. */
export function registerPeerDirectoryReader(fn) {
  peerDirectoryReader = typeof fn === 'function' ? fn : null
}

const PROBE_EXTERNAL_PROVIDER_NAMES = [
  'codex',
  'claude-code',
  'acp',
  'dsh-sdk',
  'opencode',
  'antigravity',
  'gemini',
]

let localHarnessCache = { at: 0, envSig: '', map: new Map() }

function isRegularFileSafe(p) {
  if (!p) return false
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

function platformBinCandidates(baseName) {
  return process.platform === 'win32'
    ? [`${baseName}.exe`, `${baseName}.cmd`, `${baseName}.bat`, baseName]
    : [baseName]
}

function findInSystemPath(candidates = []) {
  const rawPath = String(process.env.PATH || '')
  if (!rawPath) return ''
  for (const dir of rawPath.split(path.delimiter)) {
    const cleanDir = dir.trim().replace(/^"+|"+$/g, '')
    if (!cleanDir) continue
    for (const fileName of candidates) {
      const full = path.join(cleanDir, fileName)
      if (isRegularFileSafe(full)) return full
    }
  }
  return ''
}

function resolveCodexFromAppAlias(aliasPath) {
  try {
    const target = fs.readlinkSync(aliasPath)
    if (!target) return ''
    if (path.basename(target).toLowerCase() === 'codex.exe' && isRegularFileSafe(target)) return target
    const dir = path.dirname(target)
    for (const cand of [
      path.join(dir, 'codex.exe'),
      path.join(dir, 'resources', 'codex.exe'),
      path.join(path.dirname(dir), 'resources', 'codex.exe'),
    ]) {
      if (isRegularFileSafe(cand)) return cand
    }
  } catch {}
  return ''
}

function posixFallbackPaths(baseName) {
  const home = os.homedir()
  return [
    `/opt/homebrew/bin/${baseName}`,
    `/usr/local/bin/${baseName}`,
    path.join(home, '.local', 'bin', baseName),
    path.join(home, '.npm-global', 'bin', baseName),
    path.join(home, '.volta', 'bin', baseName),
    path.join(home, '.bun', 'bin', baseName),
    path.join(home, '.asdf', 'shims', baseName),
  ]
}

function probeLocalCodexBinary() {
  const envBin = String(process.env.DSH_CHIEF_CODEX_BIN || '').trim()
  if (envBin && isRegularFileSafe(envBin)) return envBin

  const fromPath = findInSystemPath(platformBinCandidates('codex'))
  if (fromPath) return fromPath

  if (process.platform === 'win32') {
    const localApp = String(process.env.LOCALAPPDATA || '')
    if (localApp) {
      const aliasRoot = path.join(localApp, 'Microsoft', 'WindowsApps')
      try {
        const entries = fs.readdirSync(aliasRoot, { withFileTypes: true })
        for (const ent of entries) {
          if (ent.isDirectory() && /^OpenAI\.Codex_/i.test(ent.name)) {
            const pkgAliasDir = path.join(aliasRoot, ent.name)
            try {
              for (const sub of fs.readdirSync(pkgAliasDir, { withFileTypes: true })) {
                if (!sub.name.toLowerCase().endsWith('.exe')) continue
                const hit = resolveCodexFromAppAlias(path.join(pkgAliasDir, sub.name))
                if (hit) return hit
              }
            } catch {}
          } else if (/^codex.*\.exe$/i.test(ent.name)) {
            const hit = resolveCodexFromAppAlias(path.join(aliasRoot, ent.name))
            if (hit) return hit
          }
        }
      } catch {}
    }

    // Direct Windows Store MSIX fallback when WindowsApps is readable
    const winAppsDir = process.env.ProgramFiles ? path.join(process.env.ProgramFiles, 'WindowsApps') : 'C:\\Program Files\\WindowsApps'
    try {
      const dirs = fs.readdirSync(winAppsDir, { withFileTypes: true })
        .filter(d => d.isDirectory() && /^OpenAI\.Codex_/i.test(d.name))
        .map(d => d.name)
        .sort()
        .reverse()
      for (const dirName of dirs) {
        for (const rel of ['app\\resources\\codex.exe', 'resources\\codex.exe', 'app\\codex.exe']) {
          const cand = path.join(winAppsDir, dirName, rel)
          if (isRegularFileSafe(cand)) return cand
        }
      }
    } catch {}

    const appData = String(process.env.APPDATA || '')
    const home = os.homedir()
    for (const cand of [
      appData ? path.join(appData, 'npm', 'codex.cmd') : '',
      localApp ? path.join(localApp, 'pnpm', 'codex.cmd') : '',
      path.join(home, 'scoop', 'shims', 'codex.exe'),
      path.join(home, 'scoop', 'shims', 'codex.cmd'),
      path.join(home, '.local', 'bin', 'codex.exe'),
      path.join(home, '.local', 'bin', 'codex'),
    ]) {
      if (isRegularFileSafe(cand)) return cand
    }
    return ''
  }

  for (const cand of posixFallbackPaths('codex')) {
    if (isRegularFileSafe(cand)) return cand
  }
  return ''
}

function findVersionedClaudeExe(baseDir, nestedHashDir = false) {
  if (!baseDir) return ''
  try {
    const vers = fs.readdirSync(baseDir, { withFileTypes: true })
      .filter(d => d.isDirectory())
      .map(d => d.name)
      .sort()
      .reverse()
    for (const ver of vers) {
      const verDir = path.join(baseDir, ver)
      if (!nestedHashDir) {
        const direct = path.join(verDir, 'claude.exe')
        if (isRegularFileSafe(direct)) return direct
      } else {
        try {
          const subDirs = fs.readdirSync(verDir, { withFileTypes: true }).filter(d => d.isDirectory())
          for (const sub of subDirs) {
            const nested = path.join(verDir, sub.name, 'claude.exe')
            if (isRegularFileSafe(nested)) return nested
          }
        } catch {}
      }
    }
  } catch {}
  return ''
}

function probeLocalClaudeBinary() {
  const envBin = String(process.env.DSH_CHIEF_CLAUDE_BIN || '').trim()
  if (envBin && isRegularFileSafe(envBin)) return envBin

  const fromPath = findInSystemPath(platformBinCandidates('claude'))
  if (fromPath) return fromPath

  if (process.platform === 'win32') {
    const localApp = String(process.env.LOCALAPPDATA || '')
    const appData = String(process.env.APPDATA || '')
    if (localApp) {
      const claude3p = findVersionedClaudeExe(path.join(localApp, 'Claude-3p', 'claude-code'), true)
        || findVersionedClaudeExe(path.join(localApp, 'Claude-3p', 'claude-code'), false)
      if (claude3p) return claude3p

      try {
        const pkgsDir = path.join(localApp, 'Packages')
        const claudePkgs = fs.readdirSync(pkgsDir, { withFileTypes: true })
          .filter(d => d.isDirectory() && /^AnthropicPBC\.Claude_/i.test(d.name))
        for (const pkg of claudePkgs) {
          const base = path.join(pkgsDir, pkg.name, 'LocalCache', 'Roaming', 'Claude', 'claude-code')
          const hit = findVersionedClaudeExe(base, true) || findVersionedClaudeExe(base, false)
          if (hit) return hit
        }
      } catch {}
    }
    if (appData) {
      const roamingHit = findVersionedClaudeExe(path.join(appData, 'Claude', 'claude-code'), true)
        || findVersionedClaudeExe(path.join(appData, 'Claude', 'claude-code'), false)
      if (roamingHit) return roamingHit
    }

    const home = os.homedir()
    for (const cand of [
      path.join(home, '.local', 'bin', 'claude.exe'),
      path.join(home, '.local', 'bin', 'claude'),
      appData ? path.join(appData, 'npm', 'claude.cmd') : '',
      localApp ? path.join(localApp, 'pnpm', 'claude.cmd') : '',
      path.join(home, 'scoop', 'shims', 'claude.exe'),
      path.join(home, 'scoop', 'shims', 'claude.cmd'),
    ]) {
      if (isRegularFileSafe(cand)) return cand
    }
    return ''
  }

  for (const cand of posixFallbackPaths('claude')) {
    if (isRegularFileSafe(cand)) return cand
  }
  return ''
}

function isDirSafe(p) {
  if (!p) return false
  try {
    return fs.statSync(p).isDirectory()
  } catch {
    return false
  }
}

function probeLocalCodexConfig() {
  const customHome = String(process.env.CODEX_HOME || '').trim()
  const candidates = [
    customHome ? { dir: customHome, label: 'CODEX_HOME' } : null,
    { dir: path.join(os.homedir(), '.codex'), label: '~/.codex' },
  ].filter(Boolean)
  for (const item of candidates) {
    if (isRegularFileSafe(path.join(item.dir, 'config.toml')) || isRegularFileSafe(path.join(item.dir, 'auth.json')) || isDirSafe(item.dir)) {
      return { configured: true, configLabel: item.label }
    }
  }
  if (String(process.env.OPENAI_API_KEY || '').trim()) {
    return { configured: true, configLabel: 'OPENAI_API_KEY' }
  }
  if (String(process.env.AZURE_OPENAI_API_KEY || '').trim()) {
    return { configured: true, configLabel: 'AZURE_OPENAI' }
  }
  return { configured: false, configLabel: '' }
}

function probeLocalClaudeConfig() {
  const customDir = String(process.env.CLAUDE_CONFIG_DIR || '').trim()
  const home = os.homedir()
  const appData = String(process.env.APPDATA || '')
  const candidates = [
    customDir ? { check: customDir, type: 'dir', label: 'CLAUDE_CONFIG_DIR' } : null,
    { check: path.join(home, '.claude.json'), type: 'file', label: '~/.claude.json' },
    { check: path.join(home, '.claude'), type: 'dir', label: '~/.claude' },
    appData ? { check: path.join(appData, 'Claude', 'claude_desktop_config.json'), type: 'file', label: 'Claude Desktop' } : null,
  ].filter(Boolean)
  for (const item of candidates) {
    const ok = item.type === 'file' ? isRegularFileSafe(item.check) : isDirSafe(item.check)
    if (ok) {
      return { configured: true, configLabel: item.label }
    }
  }
  if (String(process.env.CLAUDE_CODE_OAUTH_TOKEN || '').trim()) {
    return { configured: true, configLabel: 'OAuth Token' }
  }
  if (String(process.env.ANTHROPIC_API_KEY || '').trim()) {
    return { configured: true, configLabel: 'ANTHROPIC_API_KEY' }
  }
  if (String(process.env.ANTHROPIC_AUTH_TOKEN || '').trim()) {
    return { configured: true, configLabel: 'ANTHROPIC_AUTH_TOKEN' }
  }
  if (String(process.env.CLAUDE_CODE_USE_BEDROCK || '').trim()) {
    return { configured: true, configLabel: 'Bedrock' }
  }
  if (String(process.env.CLAUDE_CODE_USE_VERTEX || '').trim()) {
    return { configured: true, configLabel: 'Vertex' }
  }
  return { configured: false, configLabel: '' }
}

/** Pure filesystem detection of local external Harness CLIs (`codex`, `claude-code`) with 60s TTL cache. */
export function detectLocalHarnessBinaries({ force = false } = {}) {
  const now = Date.now()
  const envSig = [
    process.env.DSH_CHIEF_CODEX_BIN || '',
    process.env.DSH_CHIEF_CLAUDE_BIN || '',
    process.env.CODEX_HOME || '',
    process.env.CLAUDE_CONFIG_DIR || '',
    process.env.OPENAI_API_KEY ? '1' : '0',
    process.env.AZURE_OPENAI_API_KEY ? '1' : '0',
    process.env.ANTHROPIC_API_KEY ? '1' : '0',
    process.env.ANTHROPIC_AUTH_TOKEN ? '1' : '0',
    process.env.CLAUDE_CODE_OAUTH_TOKEN ? '1' : '0',
    process.env.CLAUDE_CODE_USE_BEDROCK ? '1' : '0',
    process.env.CLAUDE_CODE_USE_VERTEX ? '1' : '0',
  ].join('|')
  if (!force && envSig === localHarnessCache.envSig && (now - localHarnessCache.at) < 60_000) {
    return localHarnessCache.map
  }
  const found = new Map()
  const codexBin = probeLocalCodexBinary()
  if (codexBin) {
    const codexCfg = probeLocalCodexConfig()
    found.set('codex', {
      provider: 'codex',
      binaryPath: codexBin,
      transport: 'local-cli',
      configured: codexCfg.configured,
      configLabel: codexCfg.configLabel,
    })
  }
  const claudeBin = probeLocalClaudeBinary()
  if (claudeBin) {
    const claudeCfg = probeLocalClaudeConfig()
    found.set('claude-code', {
      provider: 'claude-code',
      binaryPath: claudeBin,
      transport: 'local-cli',
      configured: claudeCfg.configured,
      configLabel: claudeCfg.configLabel,
    })
  }
  localHarnessCache = { at: now, envSig, map: found }
  return found
}

/** Discover registered external Harness backends (`ctx.subagents` + local `ctx.subprocess` direct CLIs). */
export function discoverHarnessProviders(runtime, hostState = null) {
  const sub = runtime && typeof runtime.get === 'function' ? runtime.get('subagents') : null
  const subprocessSvc = (runtime && typeof runtime.get === 'function' ? runtime.get('subprocess') : null)
    || (hostState && hostState.activeSubprocess)
    || null
  const foundMap = new Map()
  const addProv = (pname, prov, transport = 'dsh-subagent', binaryPath = '', meta = {}) => {
    const clean = String(pname || '').trim()
    if (!clean || clean === 'spawn' || clean === 'fork') return
    if (prov && typeof prov.prepareContinuable === 'function') return
    if (!foundMap.has(clean)) {
      foundMap.set(clean, {
        prov: prov || { name: clean },
        transport,
        binaryPath,
        configured: meta.configured !== undefined ? Boolean(meta.configured) : (transport === 'dsh-subagent'),
        configLabel: meta.configLabel || (transport === 'dsh-subagent' ? 'DSH 插件' : ''),
      })
    }
  }

  if (sub && sub.providers instanceof Map) {
    for (const [pname, prov] of sub.providers.entries()) addProv(pname, prov, 'dsh-subagent', '')
  }
  if (sub && typeof sub.getProvider === 'function') {
    for (const candidate of PROBE_EXTERNAL_PROVIDER_NAMES) {
      try {
        const prov = sub.getProvider(candidate)
        if (prov) addProv(prov.name || candidate, prov, 'dsh-subagent', '')
      } catch {}
    }
  }
  if (hostState && hostState.detectedHarnessProviders instanceof Map) {
    for (const [pname, prov] of hostState.detectedHarnessProviders.entries()) addProv(pname, prov, 'dsh-subagent', '')
  }

  // Layer 2: Directly detected local Codex / Claude Code CLIs via host ctx.subprocess
  if (subprocessSvc && typeof subprocessSvc.spawn === 'function') {
    const localBins = detectLocalHarnessBinaries()
    for (const [pname, info] of localBins.entries()) {
      addProv(pname, { name: pname }, 'local-cli', info.binaryPath, {
        configured: info.configured,
        configLabel: info.configLabel,
      })
    }
  }

  const available = []
  for (const [pname, entry] of foundMap.entries()) {
    const prov = entry.prov
    const official = OFFICIAL_HARNESS_CATALOG.find(item => item.provider === pname)
    const caps = (prov && prov.capabilities && typeof prov.capabilities === 'object') ? prov.capabilities : {}
    available.push({
      provider: pname,
      label: (official && official.label) || String((prov && prov.label) || pname),
      packageName: (official && official.packageName) || '',
      accent: (official && official.accent) || '#38bdf8',
      roleHint: (official && official.roleHint) || '外部 Harness 执行进程',
      mode: 'one-shot',
      installed: true,
      transport: entry.transport,
      binaryPath: entry.binaryPath || '',
      configured: Boolean(entry.configured),
      configLabel: entry.configLabel || '',
      capabilities: {
        agentPreset: Boolean(caps.agentPreset),
        outputSchema: Boolean(caps.outputSchema),
        depthLimit: Boolean(caps.depthLimit),
      },
    })
  }

  const availableNames = new Set(available.map(x => x.provider))
  const catalog = OFFICIAL_HARNESS_CATALOG
    .filter(item => !availableNames.has(item.provider))
    .map(item => ({
      ...item,
      mode: 'one-shot',
      installed: false,
      transport: '',
      binaryPath: '',
      installCmd: `dsh plugin --profile desktop add ${item.packageName}`,
    }))

  return { available, catalog }
}

/** Force-refresh local external CLI probes, host subagent providers, and dormant session title cache. */
export function refreshBubbleDiscovery(runtime, hostState = null) {
  detectLocalHarnessBinaries({ force: true })
  if (hostState && typeof hostState === 'object') {
    hostState.dormantTitleCache = new Map()
    const sub = runtime && typeof runtime.get === 'function' ? runtime.get('subagents') : null
    if (sub) {
      if (!(hostState.detectedHarnessProviders instanceof Map)) {
        hostState.detectedHarnessProviders = new Map()
      }
      const addDetected = (pname, prov) => {
        const clean = String(pname || '').trim()
        if (!clean || clean === 'spawn' || clean === 'fork') return
        if (prov && typeof prov.prepareContinuable === 'function') return
        hostState.detectedHarnessProviders.set(clean, prov || { name: clean })
      }
      if (sub.providers instanceof Map) {
        for (const [pname, prov] of sub.providers.entries()) addDetected(pname, prov)
      }
      if (typeof sub.listProviders === 'function') {
        try {
          for (const prov of sub.listProviders() || []) {
            if (prov && (prov.name || prov.id)) addDetected(prov.name || prov.id, prov)
          }
        } catch {}
      }
      if (typeof sub.getProvider === 'function') {
        for (const candidate of PROBE_EXTERNAL_PROVIDER_NAMES) {
          try {
            const prov = sub.getProvider(candidate)
            if (prov) addDetected(prov.name || candidate, prov)
          } catch {}
        }
      }
    }
  }
  return {
    localHarnesses: detectLocalHarnessBinaries({ force: false }).size,
  }
}

/** Compute live Bubble squad membership, available Harnesses, and hard structural lock state. */
export function computeBubbleState(deps, rootId, state, directory = null) {
  const rid = String(rootId || 'global').trim() || 'global'
  const st = state || loadChiefState()
  const ws = ensureWorkspace(st, rid)
  const cfg = resolveWorkspaceConfig(st, rid)
  const cluster = (directory && Array.isArray(directory.cluster)) ? directory.cluster : getLinkedCluster(st, rid)
  const enrolledHarnesses = Array.isArray(ws.bubbleHarnesses) ? ws.bubbleHarnesses.slice() : []
  const enrolledSet = new Set(enrolledHarnesses.map(h => h && h.provider).filter(Boolean))
  const targets = (directory && Array.isArray(directory.targets)) ? directory.targets : []
  const disc = discoverHarnessProviders(deps && deps.runtime, deps && deps.hostState)

  const activeRunners = targets
    .filter(t => t && t.status === 'running')
    .map(t => ({ key: t.key, id: t.id, name: t.name, kind: t.kind }))

  const activeExternalRuns = []
  const runsMap = deps && deps.hostState && deps.hostState.activeBubbleRuns
  if (runsMap instanceof Map) {
    for (const run of runsMap.values()) {
      if (run && (!run.rootId || run.rootId === rid)) {
        activeExternalRuns.push({
          runId: run.id,
          provider: run.provider,
          label: run.label,
          childId: run.childId || '',
          transport: run.transport || '',
          startedAt: run.startedAt || 0,
        })
      }
    }
  }

  const hasCrossSquad = cluster.length > 1 || enrolledHarnesses.length > 0
  const interventionActive = Boolean(cfg && cfg.tacticalModes && cfg.tacticalModes.intervention && !cfg.stopped)
  const autoLocked = activeExternalRuns.length > 0
    || (hasCrossSquad && (activeRunners.length > 0 || interventionActive))
  const manualLocked = Boolean(ws.bubbleLock && ws.bubbleLock.manualLocked)
  const locked = manualLocked || autoLocked

  const reasons = []
  if (activeExternalRuns.length > 0) reasons.push(`${activeExternalRuns.length} 个外部 Harness 执行中`)
  if (hasCrossSquad && activeRunners.length > 0) reasons.push(`${activeRunners.length} 个会话/子代理运行中`)
  if (hasCrossSquad && interventionActive) reasons.push('主动强介入督导进行中')
  if (manualLocked && ws.bubbleLock && ws.bubbleLock.reason) reasons.push(ws.bubbleLock.reason)
  else if (manualLocked) reasons.push('已手动锁定编队结构')

  return {
    locked,
    autoLocked,
    manualLocked,
    lockReason: reasons.join(' · '),
    hasCrossSquad,
    activeRunners,
    activeExternalRuns,
    enrolledHarnesses: enrolledHarnesses.map(h => {
      const avail = disc.available.find(a => a.provider === h.provider)
      const official = OFFICIAL_HARNESS_CATALOG.find(item => item.provider === h.provider)
      const roleHint = (avail && avail.roleHint) || (official && official.roleHint) || '外部 Harness 执行进程'
      return {
        ...h,
        role: h.role || roleHint,
        roleHint,
        installed: Boolean(avail),
        transport: (avail && avail.transport) || h.transport || '',
        binaryPath: (avail && avail.binaryPath) || '',
        configured: Boolean(avail && avail.configured),
        configLabel: (avail && avail.configLabel) || '',
        running: activeExternalRuns.some(r => r.provider === h.provider),
      }
    }),
    availableHarnesses: disc.available.filter(a => !enrolledSet.has(a.provider)),
    catalogHarnesses: disc.catalog,
  }
}

const BUBBLE_LOCK_ERR = '🔒 协同水泡工作中已锁死结构，不允许中途拆解或改动编队；请等待全员收工或点击「⏹ 急停解体」'

const CLAUDE_FORWARD_ENV_KEYS = [
  'CLAUDE_CONFIG_DIR',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_SMALL_FAST_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'CLAUDE_CODE_USE_BEDROCK',
  'CLAUDE_CODE_USE_VERTEX',
  'CLAUDE_CODE_USE_FOUNDRY',
  'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC',
  'API_TIMEOUT_MS',
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_BEARER_TOKEN_BEDROCK',
  'AWS_REGION',
  'AWS_PROFILE',
  'ANTHROPIC_VERTEX_PROJECT_ID',
  'CLOUD_ML_REGION',
  'GOOGLE_APPLICATION_CREDENTIALS',
]

const CODEX_FORWARD_ENV_KEYS = [
  'CODEX_HOME',
  'OPENAI_API_KEY',
  'OPENAI_BASE_URL',
  'OPENAI_ORG_ID',
  'OPENAI_PROJECT',
  'AZURE_OPENAI_API_KEY',
  'AZURE_OPENAI_ENDPOINT',
  'AZURE_OPENAI_API_VERSION',
]

function resolveLocalCliArgv(binaryPath, cliArgs = []) {
  const bin = String(binaryPath || '').trim()
  if (!bin) return cliArgs
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin)) {
    try {
      const fd = fs.openSync(bin, 'r')
      const buf = Buffer.alloc(16384)
      let bytes = 0
      try {
        bytes = fs.readSync(fd, buf, 0, buf.length, 0)
      } finally {
        fs.closeSync(fd)
      }
      const txt = buf.toString('utf8', 0, bytes)
      const binDir = path.dirname(bin)
      const dpRe = /(?:%dp0%|%~dp0)[\\/]*([^\r\n"'`<>|*?\t]+?\.(?:mjs|cjs|js|exe))(?=["'\s]|$)/gi
      let m
      while ((m = dpRe.exec(txt)) !== null) {
        const rel = String(m[1] || '').replace(/[\\/]+/g, path.sep)
        const resolved = path.resolve(binDir, rel)
        const baseLower = path.basename(resolved).toLowerCase()
        if (!baseLower || baseLower === 'node.exe' || !isRegularFileSafe(resolved)) continue
        if (baseLower.endsWith('.exe')) return [resolved, ...cliArgs]
        return [process.execPath, resolved, ...cliArgs]
      }
      const absRe = /(["'])([A-Za-z]:[\\/][^"'\r\n]+?\.(?:exe|mjs|cjs|js))\1/gi
      while ((m = absRe.exec(txt)) !== null) {
        const resolved = path.normalize(String(m[2] || ''))
        const baseLower = path.basename(resolved).toLowerCase()
        if (!baseLower || baseLower === 'node.exe' || !isRegularFileSafe(resolved)) continue
        if (baseLower.endsWith('.exe')) return [resolved, ...cliArgs]
        return [process.execPath, resolved, ...cliArgs]
      }
    } catch {}
    return [process.env.ComSpec || 'cmd.exe', '/d', '/s', '/c', bin, ...cliArgs]
  }
  return [bin, ...cliArgs]
}

/** Build explicit opt-in child env for out-of-process external CLIs (passes dsh-subprocess scrub without leaking DEEPSEEK_* / DSH_*). */
function buildExternalHarnessEnv(provider) {
  const keys = provider === 'claude-code'
    ? CLAUDE_FORWARD_ENV_KEYS
    : (provider === 'codex' ? CODEX_FORWARD_ENV_KEYS : [])
  if (!keys.length) return undefined
  const out = {}
  for (const k of keys) {
    const val = process.env[k]
    if (typeof val === 'string' && val.length > 0) {
      out[k] = val
    }
  }
  return Object.keys(out).length ? out : undefined
}

const HARNESS_TARGET_ALIASES = {
  claude: 'claude-code',
  claudecode: 'claude-code',
  'claude code': 'claude-code',
  'claude-code': 'claude-code',
  codex: 'codex',
  'openai-codex': 'codex',
}

/** Resolve an external Harness target identifier or alias against enrolled/available Harnesses in the Bubble. */
export function resolveExternalHarnessTarget(runtime, hostState, rootId, rawTarget) {
  const clean = String(rawTarget || '').trim().replace(/^@/, '').toLowerCase()
  if (!clean) return null
  const canonical = HARNESS_TARGET_ALIASES[clean] || clean
  const bState = computeBubbleState({ runtime, hostState }, rootId)
  const enrolledList = Array.isArray(bState.enrolledHarnesses) ? bState.enrolledHarnesses : []
  const availList = Array.isArray(bState.availableHarnesses) ? bState.availableHarnesses : []

  const matchItem = (item) => {
    if (!item || !item.provider || item.installed === false) return false
    const pLow = String(item.provider).trim().toLowerCase()
    const lLow = String(item.label || '').trim().toLowerCase()
    return pLow === canonical || pLow === clean || lLow === clean
  }

  const enrolledHit = enrolledList.find(matchItem)
  if (enrolledHit) {
    return {
      provider: enrolledHit.provider,
      label: enrolledHit.label || enrolledHit.provider,
      transport: enrolledHit.transport || '',
      installed: Boolean(enrolledHit.installed),
      enrolled: true,
    }
  }

  const availHit = availList.find(matchItem)
  if (availHit) {
    return {
      provider: availHit.provider,
      label: availHit.label || availHit.provider,
      transport: availHit.transport || '',
      installed: Boolean(availHit.installed),
      enrolled: false,
    }
  }
  return null
}

/** Unified out-of-process external Harness dispatcher shared by HTTP routes & DSH Chief relays. */
export async function dispatchBubbleHarness(deps, {
  rootId = '',
  provider = '',
  text = '',
  label = '',
  fromLabel = 'DSH 参谋长',
  force = false,
  allowAutoEnroll = true,
} = {}) {
  const rid = String(rootId || 'global').trim() || 'global'
  const cleanProvider = clamp(String(provider || '').trim(), 64)
  const taskText = typeof text === 'string' ? text.trim() : ''
  const taskLabel = clamp(String(label || taskText || cleanProvider).trim(), 48)
  if (!cleanProvider || !taskText) {
    return { ok: false, statusCode: 400, error: '需要指定目标 Harness provider 与任务内容' }
  }

  const runtime = deps && deps.runtime
  const subagents = runtime && typeof runtime.get === 'function' ? runtime.get('subagents') : null
  const agentsSvc = runtime && typeof runtime.get === 'function' ? runtime.get('agents') : null
  const subprocessSvc = (runtime && typeof runtime.get === 'function' ? runtime.get('subprocess') : null)
    || (deps && deps.hostState && deps.hostState.activeSubprocess)
    || null
  const prov = subagents && typeof subagents.getProvider === 'function' ? subagents.getProvider(cleanProvider) : null
  const localHit = detectLocalHarnessBinaries().get(cleanProvider) || null
  const canUseSubagent = Boolean(subagents && typeof subagents.startActivation === 'function' && prov)
  const canUseLocalCli = Boolean(subprocessSvc && typeof subprocessSvc.spawn === 'function' && localHit && localHit.binaryPath)

  if (!canUseSubagent && !canUseLocalCli) {
    return {
      ok: false,
      statusCode: 400,
      error: `当前宿主未检测到「${cleanProvider}」外部插件，也未找到本机 CLI（可安装 @deepseek-ai/dsh-subagent-${cleanProvider} 或本机 CLI 后重试）`,
    }
  }

  const liveCaller = (agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(rid) : null)
    || (deps && typeof deps.findLiveCallerAgent === 'function' ? deps.findLiveCallerAgent(runtime, rid, null) : null)
  if (!canUseLocalCli && canUseSubagent && !liveCaller) {
    return {
      ok: false,
      statusCode: 400,
      error: '当前主对话会话未激活，请先在主窗口发一条消息激活会话',
    }
  }

  const stNow = loadChiefState()
  const wsNow = ensureWorkspace(stNow, rid)
  const official = OFFICIAL_HARNESS_CATALOG.find(item => item.provider === cleanProvider)
  const displayLabel = (official && official.label) || String((prov && prov.label) || cleanProvider)
  const isEnrolled = Array.isArray(wsNow.bubbleHarnesses) && wsNow.bubbleHarnesses.some(h => h && h.provider === cleanProvider)

  if (!isEnrolled) {
    const dirNow = peerDirectoryReader ? await peerDirectoryReader(deps, rid).catch(() => ({ targets: [], cluster: [] })) : { targets: [], cluster: [] }
    const bState = computeBubbleState(deps, rid, stNow, dirNow)
    if (bState.locked && force !== true) {
      return { ok: false, locked: true, statusCode: 409, error: BUBBLE_LOCK_ERR, bubble: bState }
    }
    if (!allowAutoEnroll) {
      return { ok: false, statusCode: 400, error: `外部 Harness「${displayLabel}」尚未编入当前协同水泡` }
    }
    setBubbleHarnessMembership(rid, {
      provider: cleanProvider,
      label: displayLabel,
      role: (official && official.roleHint) || '外部 Harness 执行进程',
      joined: true,
    })
  }

  let actionCwd = process.cwd()
  try {
    const resolvedCwd = deps && typeof deps.getSessionCwd === 'function' ? deps.getSessionCwd(rid) : ''
    if (resolvedCwd) actionCwd = resolvedCwd
  } catch {}

  let boardNow = null
  try {
    if (rid && deps && typeof deps.boardForSession === 'function' && typeof deps.boardFileFor === 'function') {
      boardNow = deps.boardForSession(deps.boardFileFor(rid))
    }
  } catch {}
  const forbiddenList = (boardNow && boardNow.bounds && Array.isArray(boardNow.bounds.forbidden))
    ? boardNow.bounds.forbidden.filter(Boolean).slice(0, 8)
    : []
  const activeWalls = listGuardWalls({ cwd: actionCwd }).filter(w => w && w.activeNow).slice(0, 8)
  const constraintLines = []
  if (forbiddenList.length) {
    constraintLines.push('禁止红线: ' + forbiddenList.join('；'))
  }
  if (activeWalls.length) {
    constraintLines.push('自定义拦截规则保护: ' + activeWalls.map(w => `${w.title}(${(w.patterns || []).join(', ')})`).join('；'))
  }
  const safePrompt = constraintLines.length
    ? `[DSH 参谋长协同水泡派单 · 外部独立进程需严格遵守以下边界]\n${constraintLines.join('\n')}\n\n[任务内容]\n${taskText}`
    : taskText

  if (deps && deps.hostState && !(deps.hostState.activeBubbleRuns instanceof Map)) {
    deps.hostState.activeBubbleRuns = new Map()
  }
  const activeRuns = deps && deps.hostState ? deps.hostState.activeBubbleRuns : null

  const ac = new AbortController()
  const runKey = nextId('brun')
  const recordDispatchState = (childIdVal, transportLabel) => {
    appendChiefAuditLog(rid, {
      kind: 'bubble_harness_dispatch',
      decision: 'allowed',
      tool: cleanProvider,
      reason: `${fromLabel} 向水泡外部 Harness「${cleanProvider}」(${transportLabel}) 派发任务并自动锁死编队：${taskLabel}`,
    })
    mutateChiefState((st) => {
      const ws = ensureWorkspace(st, rid)
      const harnessRoot = `harness:${cleanProvider}`
      ws.mailbox.push({
        id: nextId('mail'),
        from: fromLabel || 'DSH 参谋长',
        fromSession: rid,
        fromRootId: rid,
        to: cleanProvider,
        toSession: childIdVal || cleanProvider,
        toRootId: harnessRoot,
        participantRoots: [rid, harnessRoot],
        subject: `外部 Harness 派单 · ${cleanProvider}`,
        text: taskText.slice(0, 1200),
        mode: 'followup',
        channelType: 'pair',
        readBy: [rid],
        at: Date.now(),
      })
      if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: `- 【⚡ 水泡派单 · ${cleanProvider}】已启动${transportLabel === 'local-cli' ? '本机 CLI 直连' : '外部 Harness'}执行「${taskLabel}」，编队已自动锁定保护。`,
        actions: ['🔒 编队工作中已锁死'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
  }

  const writeSettlementReceipt = (childIdVal, outText, ok = true) => {
    const bodyTxt = clamp(String(outText || '').trim() || (ok ? '外部 Harness 任务已完成' : '外部 Harness 执行未返回有效结果'), 1400)
    mutateChiefState((st) => {
      const ws = ensureWorkspace(st, rid)
      const harnessRoot = `harness:${cleanProvider}`
      ws.mailbox.push({
        id: nextId('mail'),
        from: `@${cleanProvider}`,
        fromSession: childIdVal || cleanProvider,
        fromRootId: harnessRoot,
        to: 'lead',
        toSession: rid,
        toRootId: rid,
        participantRoots: [rid, harnessRoot],
        subject: `外部 Harness 回执 · ${cleanProvider}`,
        text: bodyTxt,
        mode: 'followup',
        channelType: 'pair',
        readBy: [],
        at: Date.now(),
      })
      if (ws.mailbox.length > MAIL_CAP) ws.mailbox = ws.mailbox.slice(-MAIL_CAP)
      ws.chat.push({
        id: nextId('chat'),
        role: 'chief',
        kind: 'receipt',
        text: ok
          ? `- 【✅ @${cleanProvider} 交卷】${bodyTxt.slice(0, 320)}`
          : `- 【⚠️ @${cleanProvider} 异常中断】${bodyTxt.slice(0, 320)}`,
        actions: [ok ? '解开对应执行锁' : '🔓 已释放执行锁'],
        at: Date.now(),
      })
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
  }

  let childId = runKey
  let usedTransport = 'dsh-subagent'

  if (canUseSubagent && liveCaller) {
    const activation = await subagents.startActivation({
      provider: cleanProvider,
      label: taskLabel,
      prompt: [{ type: 'text', text: safePrompt }],
      parent: liveCaller,
      signal: ac.signal,
      delivery: 'parent',
    })
    childId = String((activation && activation.childId) || '') || runKey
    if (activeRuns) {
      activeRuns.set(runKey, {
        id: runKey,
        rootId: rid,
        provider: cleanProvider,
        label: taskLabel,
        childId,
        transport: 'dsh-subagent',
        startedAt: Date.now(),
        abortController: ac,
      })
    }
    recordDispatchState(childId, 'dsh-subagent')

    if (activation && activation.result && typeof activation.result.then === 'function') {
      Promise.resolve(activation.result)
        .then((resVal) => {
          if (ac.signal.aborted) return
          const outText = (resVal && (resVal.text || resVal.output || resVal.summary))
            || (typeof resVal === 'string' ? resVal : '外部 Harness 任务已完成')
          writeSettlementReceipt(childId, outText, true)
        })
        .catch((err) => {
          if (ac.signal.aborted) return
          writeSettlementReceipt(childId, (err && err.message) || err || '执行失败', false)
        })
        .finally(() => {
          if (activeRuns) activeRuns.delete(runKey)
        })
    }
  } else {
    // Path B: Direct invocation of local Codex / Claude Code CLI via DSH host ctx.subprocess
    usedTransport = 'local-cli'
    const tmpOutFile = cleanProvider === 'codex'
      ? path.join(os.tmpdir(), `dsh-bubble-${cleanProvider}-${runKey}.txt`)
      : ''
    const cliArgs = cleanProvider === 'codex'
      ? ['exec', '--skip-git-repo-check', '--color', 'never', '-C', actionCwd, '-s', 'workspace-write', '-o', tmpOutFile, '-']
      : ['-p', '--output-format', 'text', '--no-session-persistence']
    const argv = resolveLocalCliArgv(localHit.binaryPath, cliArgs)

    const envOverrides = buildExternalHarnessEnv(cleanProvider)
    const handle = subprocessSvc.spawn({
      argv,
      cwd: actionCwd,
      graceMs: 4000,
      signal: ac.signal,
      ...(envOverrides ? { env: envOverrides } : {}),
      stdio: {
        stdin: { data: safePrompt },
        stdout: 'pipe',
        stderr: 'pipe',
      },
    })

    const outChunks = []
    const errChunks = []
    const appendChunk = (arr, byteRefSet, chunk) => {
      if (byteRefSet.n >= 65536) return
      const s = Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk || '')
      arr.push(s)
      byteRefSet.n += s.length
    }
    const outLen = { n: 0 }
    const errLen = { n: 0 }
    try { handle.stdout?.on?.('data', chunk => appendChunk(outChunks, outLen, chunk)) } catch {}
    try { handle.stderr?.on?.('data', chunk => appendChunk(errChunks, errLen, chunk)) } catch {}

    if (activeRuns) {
      activeRuns.set(runKey, {
        id: runKey,
        rootId: rid,
        provider: cleanProvider,
        label: taskLabel,
        childId,
        transport: 'local-cli',
        startedAt: Date.now(),
        abortController: ac,
        terminate: () => {
          try { if (handle && typeof handle.terminate === 'function') handle.terminate() } catch {}
        },
      })
    }
    recordDispatchState(childId, 'local-cli')

    const cleanTmpOut = () => {
      if (!tmpOutFile) return
      try { fs.rmSync(tmpOutFile, { force: true }) } catch {}
    }

    if (handle && handle.done && typeof handle.done.then === 'function') {
      Promise.resolve(handle.done)
        .then((outcome) => {
          let outText = ''
          if (tmpOutFile) {
            try {
              if (fs.existsSync(tmpOutFile)) outText = fs.readFileSync(tmpOutFile, 'utf8').trim()
            } catch {}
          }
          if (!outText) outText = outChunks.join('').trim()
          const errTail = errChunks.join('').trim().slice(-400)
          const exitCode = outcome && typeof outcome.exitCode === 'number' ? outcome.exitCode : 0
          if (ac.signal.aborted) return
          if (exitCode !== 0) {
            const diagParts = [outText, errTail].filter(Boolean)
            const combinedDiag = diagParts.join(outText && errTail ? '\n' : '').trim()
            const failMsg = combinedDiag
              ? `退出码 ${exitCode}：${clamp(combinedDiag, 1200)}`
              : `外部 CLI 进程以退出码 ${exitCode} 结束`
            writeSettlementReceipt(childId, failMsg, false)
          } else {
            writeSettlementReceipt(childId, outText || '本机 CLI 任务已执行完成', true)
          }
        })
        .catch((err) => {
          if (ac.signal.aborted) return
          writeSettlementReceipt(childId, (err && err.message) || err || 'CLI 调用失败', false)
        })
        .finally(() => {
          cleanTmpOut()
          if (activeRuns) activeRuns.delete(runKey)
        })
    } else {
      cleanTmpOut()
    }
  }

  return {
    ok: true,
    runId: runKey,
    childId,
    provider: cleanProvider,
    label: displayLabel,
    transport: usedTransport,
    bubbleLocked: true,
  }
}

