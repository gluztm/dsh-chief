/**
 * github-star.js — gluztm/dsh-chief 公开 Star 数拉取与本机 `gh` CLI 一键直连点星同步
 *
 * 【设计说明（方案 1 混搭双模）】
 *   1. 公开总数：直接读取 `https://api.github.com/repos/gluztm/dsh-chief`（带 30 分钟缓存与超时容错），
 *      无需登录即可展示全网真实 Star 数。
 *   2. 个人同步与直连点星：当用户本机已安装且登录官方 GitHub CLI（`gh`）时，仅通过宿主沙箱
 *      `subprocess.spawn` 调用 `/user/starred/gluztm/dsh-chief` 读取真实已点/未点状态；
 *      用户主动点击星标时可直接在面板内 `PUT` 点亮（已点亮时默认直接打开仓库避免误取消，
 *      显式传入 `desired: false` 时才执行 `DELETE`）。
 *   3. 严格遵守安全边界：绝不引入 `node:child_process`，绝不读取或缓存任何用户 Token，
 *      未登录/无 `gh` 时零感知优雅降级为「跳转 GitHub 仓库网页」。
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export const GITHUB_OWNER = 'gluztm'
export const GITHUB_REPO = 'dsh-chief'
export const GITHUB_REPO_SLUG = `${GITHUB_OWNER}/${GITHUB_REPO}`
export const GITHUB_REPO_URL = `https://github.com/${GITHUB_REPO_SLUG}`

const PUBLIC_TTL_MS = 30 * 60 * 1000
const PERSONAL_TTL_MS = 2 * 60 * 1000

const publicCache = { at: 0, count: null }
const ghCache = { at: 0, envSig: '', starred: null, ghAuthenticated: false, ghBin: '' }

function isFileSafe(p) {
  if (!p) return false
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

export function probeLocalGhBinary() {
  const override = String(process.env.DSH_CHIEF_GH_BIN || '').trim()
  if (override) {
    return isFileSafe(override) ? override : ''
  }

  const names = process.platform === 'win32'
    ? ['gh.exe', 'gh.cmd', 'gh.bat', 'gh']
    : ['gh']

  const rawPath = String(process.env.PATH || '')
  if (rawPath) {
    for (const dir of rawPath.split(path.delimiter)) {
      const clean = dir.trim().replace(/^"+|"+$/g, '')
      if (!clean) continue
      for (const name of names) {
        const full = path.join(clean, name)
        if (isFileSafe(full)) return full
      }
    }
  }

  const home = os.homedir()
  const localApp = String(process.env.LOCALAPPDATA || '')
  const candidates = process.platform === 'win32'
    ? [
        'C:\\Program Files\\GitHub CLI\\gh.exe',
        'C:\\Program Files (x86)\\GitHub CLI\\gh.exe',
        localApp ? path.join(localApp, 'Programs', 'GitHub CLI', 'gh.exe') : '',
        path.join(home, 'scoop', 'shims', 'gh.exe'),
        path.join(home, 'scoop', 'shims', 'gh.cmd'),
      ]
    : [
        '/opt/homebrew/bin/gh',
        '/usr/local/bin/gh',
        path.join(home, '.local', 'bin', 'gh'),
      ]

  for (const c of candidates) {
    if (c && isFileSafe(c)) return c
  }
  return ''
}

function resolveGhArgv(ghBin, args = []) {
  if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(ghBin)) {
    return [process.env.ComSpec || 'cmd.exe', '/d', '/s', '/c', ghBin, ...args]
  }
  return [ghBin, ...args]
}

async function runGhViaSubprocess(subprocessSvc, ghBin, args = [], timeoutMs = 5500) {
  if (!subprocessSvc || typeof subprocessSvc.spawn !== 'function' || !ghBin) {
    return { ok: false, exitCode: -1, stdout: '', stderr: 'subprocess unavailable' }
  }
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  const outChunks = []
  const errChunks = []
  let handle = null
  let timer = null

  try {
    handle = subprocessSvc.spawn({
      argv: resolveGhArgv(ghBin, args),
      cwd: os.tmpdir(),
      graceMs: 1500,
      ...(ac ? { signal: ac.signal } : {}),
      stdio: { stdout: 'pipe', stderr: 'pipe' },
    })
    if (!handle || !handle.done) {
      return { ok: false, exitCode: -1, stdout: '', stderr: 'invalid spawn handle' }
    }
    try { handle.stdout?.on?.('data', c => outChunks.push(Buffer.isBuffer(c) ? c.toString('utf8') : String(c || ''))) } catch {}
    try { handle.stderr?.on?.('data', c => errChunks.push(Buffer.isBuffer(c) ? c.toString('utf8') : String(c || ''))) } catch {}

    const raceList = [Promise.resolve(handle.done)]
    if (timeoutMs > 0) {
      raceList.push(new Promise((resolve) => {
        timer = setTimeout(() => {
          try { if (ac) ac.abort() } catch {}
          try { if (typeof handle.terminate === 'function') handle.terminate() } catch {}
          resolve({ exitCode: 124, timedOut: true })
        }, timeoutMs)
      }))
    }

    const doneRes = await Promise.race(raceList)
    const exitCode = Number(doneRes && doneRes.exitCode)
    return {
      ok: !doneRes?.timedOut && exitCode === 0,
      exitCode: Number.isFinite(exitCode) ? exitCode : -1,
      stdout: outChunks.join('').trim(),
      stderr: errChunks.join('').trim(),
      timedOut: Boolean(doneRes && doneRes.timedOut),
    }
  } catch (err) {
    return {
      ok: false,
      exitCode: -1,
      stdout: '',
      stderr: String((err && err.message) || err || 'gh failed'),
    }
  } finally {
    if (timer) clearTimeout(timer)
  }
}

export async function fetchPublicStarCount({ force = false } = {}) {
  if (process.env.DSH_CHIEF_DISABLE_GITHUB_FETCH === '1') {
    return publicCache.count
  }
  const now = Date.now()
  if (!force && publicCache.count !== null && (now - publicCache.at) < PUBLIC_TTL_MS) {
    return publicCache.count
  }
  const apiBase = String(process.env.DSH_CHIEF_GITHUB_API_BASE || 'https://api.github.com').replace(/\/+$/, '')
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = setTimeout(() => {
    try { if (ac) ac.abort() } catch {}
  }, 3500)
  try {
    const resp = await fetch(`${apiBase}/repos/${GITHUB_REPO_SLUG}`, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'dsh-chief-plugin',
      },
      ...(ac ? { signal: ac.signal } : {}),
    })
    if (!resp || !resp.ok) return publicCache.count
    const data = await resp.json()
    const raw = data && typeof data.stargazers_count === 'number' ? data.stargazers_count : null
    if (raw !== null && Number.isFinite(raw) && raw >= 0) {
      publicCache.count = Math.round(raw)
      publicCache.at = Date.now()
    }
    return publicCache.count
  } catch {
    return publicCache.count
  } finally {
    clearTimeout(timer)
  }
}

async function queryPersonalGhStar({ subprocessSvc, ghBin, force = false } = {}) {
  const now = Date.now()
  const envSig = `${ghBin}|${process.env.DSH_CHIEF_GH_BIN || ''}`
  if (!force && ghCache.envSig === envSig && (now - ghCache.at) < PERSONAL_TTL_MS) {
    return {
      starred: ghCache.starred,
      ghAuthenticated: ghCache.ghAuthenticated,
    }
  }

  const res = await runGhViaSubprocess(
    subprocessSvc,
    ghBin,
    ['api', `/user/starred/${GITHUB_REPO_SLUG}`],
    5000,
  )
  const combined = `${res.stdout}\n${res.stderr}`
  if (res.ok && res.exitCode === 0) {
    ghCache.at = Date.now()
    ghCache.envSig = envSig
    ghCache.ghBin = ghBin
    ghCache.ghAuthenticated = true
    ghCache.starred = true
    return { starred: true, ghAuthenticated: true }
  }
  if (/404|not found/i.test(combined)) {
    ghCache.at = Date.now()
    ghCache.envSig = envSig
    ghCache.ghBin = ghBin
    ghCache.ghAuthenticated = true
    ghCache.starred = false
    return { starred: false, ghAuthenticated: true }
  }
  ghCache.at = Date.now()
  ghCache.envSig = envSig
  ghCache.ghBin = ghBin
  ghCache.ghAuthenticated = false
  ghCache.starred = null
  return { starred: null, ghAuthenticated: false }
}

export async function getGithubStarStatus({
  subprocessSvc = null,
  checkPersonal = false,
  force = false,
} = {}) {
  const ghBin = probeLocalGhBinary()
  const ghAvailable = Boolean(ghBin && subprocessSvc && typeof subprocessSvc.spawn === 'function')
  const starCount = await fetchPublicStarCount({ force })

  let starred = null
  let ghAuthenticated = false
  if (checkPersonal && ghAvailable) {
    const personal = await queryPersonalGhStar({ subprocessSvc, ghBin, force })
    starred = personal.starred
    ghAuthenticated = personal.ghAuthenticated
  }

  return {
    ok: true,
    repo: GITHUB_REPO_SLUG,
    repoUrl: GITHUB_REPO_URL,
    starCount,
    starred,
    ghAvailable,
    ghAuthenticated,
    syncedVia: ghAuthenticated ? 'gh' : 'public',
    checkedAt: Date.now(),
  }
}

export async function toggleGithubStar({
  subprocessSvc = null,
  desired = null,
} = {}) {
  const ghBin = probeLocalGhBinary()
  const ghAvailable = Boolean(ghBin && subprocessSvc && typeof subprocessSvc.spawn === 'function')
  const starCountBefore = await fetchPublicStarCount({ force: false })

  if (!ghAvailable) {
    return {
      ok: true,
      mode: 'web_fallback',
      reason: 'gh_unavailable',
      repo: GITHUB_REPO_SLUG,
      repoUrl: GITHUB_REPO_URL,
      fallbackUrl: GITHUB_REPO_URL,
      starred: null,
      ghAvailable: false,
      ghAuthenticated: false,
      starCount: starCountBefore,
      syncedVia: 'public',
    }
  }

  const cur = await queryPersonalGhStar({ subprocessSvc, ghBin, force: true })
  if (!cur.ghAuthenticated) {
    return {
      ok: true,
      mode: 'web_fallback',
      reason: 'gh_auth_required',
      repo: GITHUB_REPO_SLUG,
      repoUrl: GITHUB_REPO_URL,
      fallbackUrl: GITHUB_REPO_URL,
      starred: null,
      ghAvailable: true,
      ghAuthenticated: false,
      starCount: starCountBefore,
      syncedVia: 'public',
    }
  }

  if (desired === null && cur.starred === true) {
    return {
      ok: true,
      mode: 'already_starred',
      changed: false,
      repo: GITHUB_REPO_SLUG,
      repoUrl: GITHUB_REPO_URL,
      starred: true,
      ghAvailable: true,
      ghAuthenticated: true,
      starCount: starCountBefore,
      syncedVia: 'gh',
    }
  }

  const targetState = typeof desired === 'boolean' ? desired : true
  if (targetState === cur.starred) {
    return {
      ok: true,
      mode: 'gh_direct',
      changed: false,
      repo: GITHUB_REPO_SLUG,
      repoUrl: GITHUB_REPO_URL,
      starred: cur.starred,
      ghAvailable: true,
      ghAuthenticated: true,
      starCount: starCountBefore,
      syncedVia: 'gh',
    }
  }

  const method = targetState ? 'PUT' : 'DELETE'
  const mutRes = await runGhViaSubprocess(
    subprocessSvc,
    ghBin,
    ['api', '-X', method, `/user/starred/${GITHUB_REPO_SLUG}`],
    5500,
  )

  if (!mutRes.ok || mutRes.exitCode !== 0) {
    return {
      ok: true,
      mode: 'web_fallback',
      reason: 'gh_mutation_failed',
      repo: GITHUB_REPO_SLUG,
      repoUrl: GITHUB_REPO_URL,
      fallbackUrl: GITHUB_REPO_URL,
      starred: null,
      ghAvailable: true,
      ghAuthenticated: false,
      starCount: starCountBefore,
      syncedVia: 'public',
    }
  }

  ghCache.at = Date.now()
  ghCache.envSig = `${ghBin}|${process.env.DSH_CHIEF_GH_BIN || ''}`
  ghCache.ghBin = ghBin
  ghCache.ghAuthenticated = true
  ghCache.starred = targetState

  let nextCount = starCountBefore
  if (typeof nextCount === 'number') {
    nextCount = targetState ? nextCount + 1 : Math.max(0, nextCount - 1)
    publicCache.count = nextCount
    publicCache.at = Date.now()
  }

  return {
    ok: true,
    mode: 'gh_direct',
    changed: true,
    repo: GITHUB_REPO_SLUG,
    repoUrl: GITHUB_REPO_URL,
    starred: targetState,
    ghAvailable: true,
    ghAuthenticated: true,
    starCount: nextCount,
    syncedVia: 'gh',
  }
}

export function resetGithubStarCacheForTests() {
  publicCache.at = 0
  publicCache.count = null
  ghCache.at = 0
  ghCache.envSig = ''
  ghCache.starred = null
  ghCache.ghAuthenticated = false
  ghCache.ghBin = ''
}
