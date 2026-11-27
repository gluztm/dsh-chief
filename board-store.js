/**
 * board-store.js
 *
 * Board file persistence, in-memory cache, cross-process locking, and session board views.
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { threadId } from 'node:worker_threads'
import {
  BOARD_VERSION,
  nowMs,
  emptyBoard,
  str,
  BOUND_FIELDS,
  BOUND_CAP,
  normalizeBounds,
  normalizeBoard,
} from './board-schema.js'

export function createBoardStore(deps) {

  const resolveRootSessionId = (...args) => deps.resolveRootSessionId(...args)

  function pendingFile() {
    return path.join(path.dirname(boardFile()), 'pending-transfer.json')
  }

  function readPending() {
    try {
      const raw = JSON.parse(fs.readFileSync(pendingFile(), 'utf8'))
      return raw && typeof raw.text === 'string' && raw.text ? raw : null
    } catch {
      return null
    }
  }

  function writePending(value) {
    try {
      fs.mkdirSync(path.dirname(pendingFile()), { recursive: true })
      fs.writeFileSync(pendingFile(), JSON.stringify(value, null, 2), 'utf8')
      return true
    } catch {
      return false
    }
  }

  function clearPending() {
    try {
      fs.unlinkSync(pendingFile())
    } catch {}
  }

  function pendingDeployFile() {
    return path.join(path.dirname(boardFile()), 'pending-chief-deploy.json')
  }

  function readPendingDeploy() {
    try {
      const raw = JSON.parse(fs.readFileSync(pendingDeployFile(), 'utf8'))
      return raw && typeof raw.fromSessionId === 'string' && raw.fromSessionId ? raw : null
    } catch {
      return null
    }
  }

  function writePendingDeploy(value) {
    try {
      fs.mkdirSync(path.dirname(pendingDeployFile()), { recursive: true })
      fs.writeFileSync(pendingDeployFile(), JSON.stringify(value, null, 2), 'utf8')
      return true
    } catch {
      return false
    }
  }

  function clearPendingDeploy() {
    try {
      fs.unlinkSync(pendingDeployFile())
    } catch {}
  }

  function boardFile() {
    const home = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
    return path.join(home, 'chief', 'board.json')
  }

  /** One JSON board per Session (or shared across a subagent tree rooted at lead):
   *  %DSH_HOME%/chief/boards/<sid>.json. */
  function sessionBoardFile(sessionId) {
    const rootSid = resolveRootSessionId(sessionId)
    const sid = String(rootSid || '').replace(/[^\w-]/g, '')
    const dir = path.join(path.dirname(boardFile()), 'boards')
    return sid ? path.join(dir, sid + '.json') : ''
  }

  function boardFileFor(sessionId) {
    return sessionBoardFile(sessionId) || boardFile()
  }

  /* ------------------------------------------------------------------ storage */

  /* Per-file caches keyed by path — one board per Session, one shared board for
   * the global anchor/settings. */
  const caches = new Map()

  function loadBoard(file) {
    file = file || boardFile()
    const entry = caches.get(file) || { mtime: -1, board: null }
    try {
      const stat = fs.statSync(file)
      if (entry.board && entry.mtime === stat.mtimeMs) return entry.board
      const board = normalizeBoard(JSON.parse(fs.readFileSync(file, 'utf8')))
      caches.set(file, { mtime: stat.mtimeMs, board })
      return board
    } catch {
      return entry.board && entry.mtime === -1 ? entry.board : emptyBoard()
    }
  }

  const LOCK_WAIT_MS = 10000

  const LOCK_STALE_MS = 15000

  const CONTENDED_LOCK_CODES = new Set(['EEXIST', 'EPERM', 'EACCES', 'EBUSY'])

  const heldLocks = new Set()

  const lockSleeper = new Int32Array(new SharedArrayBuffer(4))

  function sleepSync(ms) {
    try {
      Atomics.wait(lockSleeper, 0, 0, ms)
    } catch {}
  }

  function atomicRenameSync(tmp, file) {
    let lastErr = null
    for (let attempt = 0; attempt < 8; attempt += 1) {
      try {
        fs.renameSync(tmp, file)
        return
      } catch (err) {
        lastErr = err
        const code = err && err.code
        if (code !== 'EPERM' && code !== 'EACCES' && code !== 'EBUSY' && code !== 'ENOENT') {
          break
        }
        if (code === 'ENOENT') {
          try {
            fs.mkdirSync(path.dirname(file), { recursive: true })
          } catch {}
        }
        sleepSync(2 + attempt * 2)
      }
    }
    try {
      if (fs.existsSync(tmp)) fs.unlinkSync(tmp)
    } catch {}
    if (lastErr) throw lastErr
  }

  function saveBoard(board, file) {
    file = file || boardFile()
    board.version = BOARD_VERSION
    board.updatedAt = nowMs()
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.${process.pid}.${threadId}.${Date.now().toString(36)}.${Math.random().toString(36).slice(2, 8)}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(board, null, 2), 'utf8')
    atomicRenameSync(tmp, file)
    let mtime = -1
    try {
      mtime = fs.statSync(file).mtimeMs
    } catch {}
    caches.set(file, { mtime, board })
    return board
  }

  /* ----------------------------------------------------------------- write lock */

  /* Every mutation is a read-modify-write of one JSON file. `rename` makes the
   * write itself atomic, but nothing stops two writers from reading the same
   * board, each appending their own entry, and the second rename silently
   * discarding the first one's task, note or memory line. A turn-stopping
   * listener and a browser route land in the same Session board often enough to
   * lose data that way, so the whole read-modify-write runs under
   * `<file>.lock`, created with O_EXCL (works across processes, worker_threads,
   * and across the host/browser halves). */

  /** Take the board lock. Returns a release function; always call it in a finally.
   *  Nested calls on the same path return a no-op release instead of deadlocking:
   *  every holder here is synchronous, so "already held" can only mean "held by
   *  my own call stack". */
  function acquireBoardLock(file) {
    file = file || boardFile()
    if (heldLocks.has(file)) return () => {}
    const lock = file + '.lock'
    try {
      fs.mkdirSync(path.dirname(lock), { recursive: true })
    } catch {}
    const deadline = Date.now() + LOCK_WAIT_MS
    for (;;) {
      try {
        const fd = fs.openSync(lock, 'wx')
        try {
          fs.writeSync(fd, `${process.pid}:${threadId}`)
        } catch {}
        fs.closeSync(fd)
        heldLocks.add(file)
        return () => {
          heldLocks.delete(file)
          try {
            fs.unlinkSync(lock)
          } catch {}
        }
      } catch (error) {
        const code = error && error.code
        if (code === 'ENOENT' && Date.now() < deadline) {
          try {
            fs.mkdirSync(path.dirname(lock), { recursive: true })
          } catch {}
          sleepSync(2)
          continue
        }
        if (!error || !CONTENDED_LOCK_CODES.has(code)) {
          // Best effort: an unwritable lock path must not fail every board write.
          // The rename alone is still atomic, so the only loss is serialisation.
          heldLocks.add(file)
          return () => heldLocks.delete(file)
        }
        if (Date.now() >= deadline) {
          // A wedged holder must not freeze the board for the rest of the
          // session: break it once and continue.
          try {
            fs.unlinkSync(lock)
          } catch {}
          heldLocks.add(file)
          return () => heldLocks.delete(file)
        }
        if (code === 'EEXIST') {
          try {
            const stat = fs.statSync(lock)
            if (Date.now() - stat.mtimeMs > LOCK_STALE_MS) {
              fs.unlinkSync(lock)
              continue
            }
          } catch {}
        }
        sleepSync(2 + Math.floor(Math.random() * 4))
      }
    }
  }

  /** Run one read-modify-write under the lock, with a cache-invalidated read so
   *  the board it mutates is the one currently on disk. */
  function withBoardLock(file, run) {
    const target = file || boardFile()
    const release = acquireBoardLock(target)
    caches.delete(target)
    try {
      return run()
    } finally {
      release()
    }
  }

  /**
   * The board a Session gets to READ: its own, plus the limited things that are
   * deliberately machine-wide. Writes never go through here — they always hit the
   * raw per-session file, so this view can never leak one conversation's work
   * into another one.
   *
   * What crosses the boundary, and why:
   *   - notes: all of them, anchors first. A lesson pinned in one conversation is
   *     exactly the thing that must survive into the next one, and title-dedupe
   *     keeps the session's own copy when it has one. Every other note on the
   *     shared board crosses too, because a write nobody can read back is
   *     write-only storage: demoting an anchor past the cap used to erase its
   *     lesson from every panel, which is the opposite of what the cap promises.
   *     Each inherited note carries shared:true, so the panel can send its edit
   *     and its delete to the board the note actually lives on instead of the
   *     session board, where the host would answer "no such note".
   *   - bounds: always, and only, the shared list. Bounds are standing
   *     instructions from the operator ("don't commit", "install_bundle dies with
   *     EPERM"); a fresh conversation that cannot see them starts by breaking
   *     them. The panel edits that one shared list, so a session's seeded copy is
   *     a snapshot, not a decision: handing it back would shadow every later edit.
   *     A stale operator instruction is worse than a missing one.
   *   - objective: only while the session has none of its own, same reasoning —
   *     a new conversation should know what the machine is working on, but as
   *     soon as it states its own goal the shared one is gone.
   *   - settings: never inherited here; autoInject/guardIdle are machine flags
   *     read straight off the shared board at their point of use.
   */
  function boardForSession(file) {
    const board = loadBoard(file)
    try {
      if (file === boardFile()) {
        const pinnedOnly = normalizeBounds(board.bounds)
        const pausedPinned = normalizeBounds(board.pausedBounds)
        return {
          ...board,
          bounds: pinnedOnly,
          pinnedBounds: pinnedOnly,
          localBounds: { allowed: [], forbidden: [], notes: [] },
          pausedBounds: pausedPinned,
          pausedPinnedBounds: pausedPinned,
          inherited: { anchors: 0, notes: 0, bounds: false, objective: false },
        }
      }
      const shared = loadBoard()
      const out = { ...board }
      const inherited = { anchors: 0, notes: 0, bounds: false, objective: false }

      const sharedNotes = shared.notes || []
      const anchors = sharedNotes.filter(note => (note.tags || []).includes('anchor'))
      const others = sharedNotes.filter(note => !(note.tags || []).includes('anchor'))
      // Anchors first, then the rest: the front of the list is what a reader
      // reaches first, and an anchor outranks a working note for that slot.
      const carry = anchors.concat(others)
      if (carry.length) {
        const seen = new Set((board.notes || []).map(note => note.title))
        const extra = carry.filter(note => !seen.has(note.title))
        if (extra.length) {
          out.notes = (board.notes || []).concat(extra.map(note => ({ ...note, session: note.session || '', shared: true })))
          inherited.anchors = extra.filter(note => (note.tags || []).includes('anchor')).length
          inherited.notes = extra.length
        }
      }

      // Two-tier boundaries:
      //   1) Pinned Global Shared (`shared.bounds`) — stamped with 📌, inherited across ALL tasks/conversations.
      //   2) Task-Local (`board.bounds`) — applies ONLY to this root session & its subagent tree.
      const pinnedBounds = normalizeBounds(shared.bounds)
      const rawLocal = normalizeBounds(board.bounds)
      const localBounds = { allowed: [], forbidden: [], notes: [] }
      const mergedBounds = { allowed: [], forbidden: [], notes: [] }
      for (const col of BOUND_FIELDS) {
        const pinList = pinnedBounds[col] || []
        const pinSet = new Set(pinList)
        const localOnly = (rawLocal[col] || []).filter(item => !pinSet.has(item))
        localBounds[col] = localOnly
        mergedBounds[col] = pinList.concat(localOnly).slice(0, BOUND_CAP)
      }
      out.bounds = mergedBounds
      out.pinnedBounds = pinnedBounds
      out.localBounds = localBounds
      const pausedPinnedBounds = normalizeBounds(shared.pausedBounds)
      const rawLocalPaused = normalizeBounds(board.pausedBounds)
      const mergedPausedBounds = { allowed: [], forbidden: [], notes: [] }
      for (const col of BOUND_FIELDS) {
        const activeSet = new Set(mergedBounds[col] || [])
        const ppList = (pausedPinnedBounds[col] || []).filter(item => !activeSet.has(item))
        const ppSet = new Set(ppList)
        const lpList = (rawLocalPaused[col] || []).filter(item => !activeSet.has(item) && !ppSet.has(item))
        mergedPausedBounds[col] = ppList.concat(lpList).slice(0, BOUND_CAP)
      }
      out.pausedBounds = mergedPausedBounds
      out.pausedPinnedBounds = pausedPinnedBounds
      inherited.bounds = Boolean(
        pinnedBounds.allowed.length || pinnedBounds.forbidden.length || pinnedBounds.notes.length,
      )

      // "never wrote one" is not the same state as "wrote an empty one". The panel
      // paints the borrowed objective into the very textarea a Session edits, so
      // erasing it and pressing 保存目标 used to write objective:'' — and the next
      // read handed the shared text straight back, leaving the box disobedient with
      // no visible reason. objectiveAt is the record of "this Session stated an
      // objective, even if the statement was 'none'": plan.set/objective.set stamp
      // it, inheritance never does.
      const statedOwn = typeof board.objectiveAt === 'number' && board.objectiveAt > 0
      if (!str(board.objective, '') && !statedOwn) {
        if (str(shared.objective, '')) {
          out.objective = shared.objective
          out.objectiveBy = shared.objectiveBy || ''
          out.objectiveAt = shared.objectiveAt || 0
          inherited.objective = true
        }
      }

      out.inherited = inherited
      return out
    } catch {
      return board
    }
  }

  return {
    pendingFile,
    readPending,
    writePending,
    clearPending,
    pendingDeployFile,
    readPendingDeploy,
    writePendingDeploy,
    clearPendingDeploy,
    boardFile,
    sessionBoardFile,
    boardFileFor,
    loadBoard,
    saveBoard,
    acquireBoardLock,
    withBoardLock,
    boardForSession,
  }
}
