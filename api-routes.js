/**
 * api-routes.js
 *
 * Same-origin HTTP route table and request guards for the DSH Chief browser panel.
 */

import fs from 'node:fs'
import path from 'node:path'
import { getGithubStarStatus, toggleGithubStar } from './github-star.js'
import { renderDigest } from './digest.js'
import { memorySections, renderMemoryDigest } from './memory.js'
import {
  loadChiefState,
  resolveWorkspaceConfig,
  getLinkedCluster,
  setPeerLink,
  listChiefModels,
  deliverCrossMessage,
  getChiefView,
  recommendAndSetCompactThreshold,
  askOrCommandChief,
  consolidateBoundsWithChief,
  organizeArchivesWithChief,
  harvestTurnDetailsToArchive,
  precipitateExperienceWithChief,
  distillSessionArchivesToGlobal,
  updateWorkspaceFlippedIds,
  proposeBoundToChief,
  handleSuggestionDecision,
  executeBatchSuggestions,
  updateChiefConfig,
  suggestCoreObjectiveWithChief,
  relayArchivesWithChief,
  mutateChiefFact,
  handleApprovalDecision,
  handleElevationDecision,
  scheduleChiefTurnReview,
} from './chief.js'
import {
  getChiefActiveWork,
  mutateChiefState,
  ensureWorkspace,
  activateChiefSession,
  queueChiefApproval,
  normalizeSuggestion,
  hasValidChiefRiskAck,
  summarizeLlmLedger,
  setBubbleHarnessMembership,
  setBubbleManualLock,
  appendChiefAuditLog,
  clamp,
  SUGGESTIONS_CAP,
  CHAT_CAP,
  nextId,
} from './chief-state.js'
import { listPeerDirectory, computeBubbleState, dispatchBubbleHarness, refreshBubbleDiscovery } from './chief-network.js'
import {
  resolveProjectKey,
  getArchiveMeta,
  getThreeTierArchiveCounts,
  listArchiveHeaders,
  getArchiveDetail,
  mutateArchive,
  getTakenOutArchivesForSession,
  getTakenOutGlobalForSession,
  getFlippedOutPrecipitatedForSession,
  getPrecipitatedDetail,
  mutatePrecipitated,
  copyPrecipitatedToVault,
} from './archives.js'
import {
  DEFAULT_CHIEF_PERMISSION_MODE,
  HUMAN_BOUNDS_CONFIRM_TOKEN,
  listGuardWalls,
  normalizePermissionMode,
  permissionRank,
  buildCapabilityScope,
} from './chief-executor.js'
import {
  API,
  BACKEND_BUILD,
  BODY_LIMIT,
  emptyBoard,
  normalizeBoundFieldName,
  guardCount,
  pushLog,
  safe,
} from './board-schema.js'

export function createApiRoutes(deps) {

  const archiveTarget = (...args) => deps.archiveTarget(...args)
  const boardFile = (...args) => deps.boardFile(...args)
  const boardFileFor = (...args) => deps.boardFileFor(...args)
  const boardForSession = (...args) => deps.boardForSession(...args)
  const boundaries = (...args) => deps.boundaries(...args)
  const collectDigestArchiveContext = (...args) => deps.collectDigestArchiveContext(...args)
  const executeSubagentAction = (...args) => deps.executeSubagentAction(...args)
  const fetchTeamTasks = (...args) => deps.fetchTeamTasks(...args)
  const getSessionContextBreakdown = (...args) => deps.getSessionContextBreakdown(...args)
  const linkedPeersForSession = (...args) => deps.linkedPeersForSession(...args)
  const loadBoard = (...args) => deps.loadBoard(...args)
  const makeChiefDeps = (...args) => deps.makeChiefDeps(...args)
  const probeSubagentSupport = (...args) => deps.probeSubagentSupport(...args)
  const readPending = (...args) => deps.readPending(...args)
  const refreshSubagentTree = (...args) => deps.refreshSubagentTree(...args)
  const resolveAgentIdentity = (...args) => deps.resolveAgentIdentity(...args)
  const resolveEffectiveHandoff = (...args) => deps.resolveEffectiveHandoff(...args)
  const resolveRootSessionId = (...args) => deps.resolveRootSessionId(...args)
  const runAction = (...args) => deps.runAction(...args)
  const saveBoard = (...args) => deps.saveBoard(...args)
  const sessionName = (...args) => deps.sessionName(...args)
  const transcriptTimes = (...args) => deps.transcriptTimes(...args)
  const transferChief = (...args) => deps.transferChief(...args)
  const withBoardLock = (...args) => deps.withBoardLock(...args)

  /* ---------------------------------------------------------------------- routes */

  function sendJson(res, status, value) {
    const body = JSON.stringify(value)
    res.statusCode = status
    res.setHeader('content-type', 'application/json; charset=utf-8')
    res.setHeader('cache-control', 'no-store')
    res.end(body)
  }

  function readBody(req) {
    return new Promise((resolve, reject) => {
      const chunks = []
      let size = 0
      req.on('data', chunk => {
        size += chunk.length
        if (size > BODY_LIMIT) {
          reject(new Error('body too large'))
          req.destroy()
          return
        }
        chunks.push(chunk)
      })
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        if (!text) return resolve({})
        try {
          resolve(JSON.parse(text))
        } catch (error) {
          reject(error)
        }
      })
      req.on('error', reject)
    })
  }

  function resolveArchiveHttpScope(raw) {
    const s = typeof raw === 'string' ? raw.trim().toLowerCase() : ''
    if (s === 'global') return 'global'
    if (s === 'precipitated' || s === 'cold' || s === 'vault') return 'precipitated'
    return 'session'
  }

  function resolveBoundRootSid(sessionId = '') {
    const raw = String(sessionId || '').trim()
    if (!raw || raw === 'global') return ''
    const root = String(resolveRootSessionId(raw) || raw).trim()
    return (!root || root === 'global') ? '' : root
  }

  function markSessionActivated(sessionId = '') {
    const root = resolveBoundRootSid(sessionId)
    if (root) activateChiefSession(root, { force: true })
  }

  function collectDeskItemsForUi(runtime, rootId, cabinetId = '') {
    if (!rootId) return []
    const targetOpt = archiveTarget(runtime, rootId, { cabinetId, vaultScope: 'session' })
    const out = []
    try {
      for (const it of getTakenOutArchivesForSession(rootId, targetOpt)) {
        out.push({ id: it.id, scope: 'session', title: it.title, summary: it.summary || '', folder: it.folder || 'inbox', paperclip: it.paperclip || 'silver' })
      }
    } catch {}
    try {
      const gOpt = archiveTarget(runtime, rootId, { cabinetId: '', vaultScope: 'global' })
      for (const it of getTakenOutGlobalForSession(rootId, gOpt)) {
        out.push({ id: it.id, scope: 'global', title: it.title, summary: it.summary || '', folder: it.folder || 'coords', paperclip: it.paperclip || 'silver' })
      }
    } catch {}
    try {
      const st = loadChiefState()
      const ws = st && st.workspaces && st.workspaces[rootId]
      const flippedIds = ws && Array.isArray(ws.flippedPrecipitatedIds) ? ws.flippedPrecipitatedIds : []
      if (flippedIds.length) {
        const pk = resolveProjectKey(targetOpt.cwd)
        for (const it of getFlippedOutPrecipitatedForSession(pk, rootId, true, targetOpt)) {
          out.push({ id: it.id, scope: 'precipitated', title: it.title, summary: it.summary || '', folder: it.category || 'contracts', paperclip: 'gold' })
        }
      }
    } catch {}
    return out
  }

  function routeTable(runtime) {
    const guard = (req, res) => {
      const connection = runtime.get('connection')
      if (connection && typeof connection.requestRejection === 'function') {
        try {
          const rejection = connection.requestRejection({ headers: req.headers })
          if (rejection) {
            sendJson(res, rejection, { ok: false, error: rejection === 401 ? 'unauthorized' : 'forbidden' })
            return false
          }
        } catch (err) {
          console.warn('[dsh-chief] request guard check failed; failing closed:', err && err.message ? err.message : err)
          sendJson(res, 403, { ok: false, error: 'forbidden (guard check failed)' })
          return false
        }
      }
      return true
    }

    return [
      {
        path: API + '/snapshot',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            let sessionId = ''
            try {
              sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
            } catch {}
            const board = sessionId ? boardForSession(boardFileFor(sessionId)) : emptyBoard()
            const subagents = sessionId ? await refreshSubagentTree(runtime, sessionId, board) : []
            const agentIdentity = sessionId ? resolveAgentIdentity(runtime, sessionId) : null
            const secState = loadChiefState()
            const rootSid = resolveRootSessionId(sessionId) || sessionId || 'global'
            const cluster = getLinkedCluster(secState, rootSid)
            let pendingSuggestions = 0
            let factsCount = 0
            let mailboxCount = 0
            for (const cid of cluster) {
              const ws = secState.workspaces && secState.workspaces[cid]
              if (!ws) continue
              if (Array.isArray(ws.suggestions)) pendingSuggestions += ws.suggestions.filter(s => s.status === 'pending').length
              if (Array.isArray(ws.facts)) factsCount += ws.facts.length
              if (Array.isArray(ws.mailbox)) mailboxCount += ws.mailbox.length
            }
            let followModelRef = ''
            try {
              const agentsSvc = runtime && runtime.get('agents')
              const ag = agentsSvc && typeof agentsSvc.get === 'function' ? (agentsSvc.get(sessionId) || agentsSvc.get(rootSid)) : null
              const hdr = ag && ag.session && typeof ag.session.requestHeader === 'function'
                ? ag.session.requestHeader()
                : (ag && ag.session && ag.session.header ? ag.session.header : null)
              const hcfg = hdr && hdr.config ? hdr.config : hdr
              if (hcfg && hcfg.provider && hcfg.model && !String(hcfg.provider).startsWith('local-agent')) {
                followModelRef = `${hcfg.provider}/${hcfg.model}`
              } else {
                const defSel = runtime && runtime.get('agentDefaultModel')?.currentSelection?.()
                if (defSel && defSel.provider && defSel.model && !String(defSel.provider).startsWith('local-agent')) {
                  followModelRef = `${defSel.provider}/${defSel.model}`
                }
              }
            } catch {}
            const effCfg = resolveWorkspaceConfig(secState, rootSid)
            let pinnedModelRef = effCfg.modelRef || ''
            if (pinnedModelRef) {
              try {
                const llmSvc = runtime && runtime.get('llm')
                if (llmSvc && typeof llmSvc.listProviders === 'function') {
                  const provs = new Set((llmSvc.listProviders() || []).map(p => p && p.id).filter(Boolean))
                  const pName = pinnedModelRef.split('/')[0]
                  if (provs.size > 0 && !provs.has(pName)) pinnedModelRef = ''
                }
              } catch {}
            }
            const rootWs = secState.workspaces && secState.workspaces[rootSid]
            const tacticalModes = effCfg.tacticalModes || {}
            const flippedIds = (rootWs && Array.isArray(rootWs.flippedPrecipitatedIds)) ? rootWs.flippedPrecipitatedIds.slice() : []
            const boundRootSid = resolveBoundRootSid(sessionId)
            const sessionArchOpt = archiveTarget(runtime, boundRootSid, { cabinetId: board.activeCabinetId, vaultScope: 'session' })
            const archiveMeta = {
              ...getArchiveMeta(boundRootSid, sessionArchOpt),
              counts: getThreeTierArchiveCounts(boundRootSid, flippedIds, sessionArchOpt),
            }
            const hostCompat = probeSubagentSupport(runtime)
            sendJson(res, 200, {
              ok: true,
              board,
              subagents,
              agentIdentity,
              teamTasks: sessionId ? fetchTeamTasks(runtime, { id: sessionId }) : undefined,
              boundaries: boundaries(runtime, sessionId),
              hostCompat,
              chiefMeta: {
                backendBuild: BACKEND_BUILD,
                hostCompat,
                chiefName: effCfg.chiefName || '',
                sessionEnabled: Boolean(effCfg.sessionEnabled),
                defaultAutoEnableSessions: Boolean(effCfg.defaultAutoEnableSessions),
                globalSafetyGuardEnabled: effCfg.globalSafetyGuardEnabled !== false,
                sessionSafetyGuardEnabled: effCfg.sessionSafetyGuardEnabled !== false,
                paceMode: effCfg.paceMode || 'manual',
                runMode: effCfg.runMode || 'off',
                managedIdleTimeoutMs: effCfg.managedIdleTimeoutMs || 15 * 60 * 1000,
                notifyEnabled: effCfg.notifyEnabled !== false,
                notifySound: Boolean(effCfg.notifySound),
                uiLang: effCfg.uiLang || 'auto',
                managedBudgetMaxCalls: effCfg.managedBudgetMaxCalls ?? 30,
                managedBudgetMaxTokens: effCfg.managedBudgetMaxTokens ?? 300000,
                llmLedgerSummary: summarizeLlmLedger(rootWs && rootWs.llmLedger, effCfg),
                alertEvents: ((rootWs && Array.isArray(rootWs.alertEvents)) ? rootWs.alertEvents : []).slice(-10),
                thinkingEffort: effCfg.thinkingEffort || 'auto',
                teamEffortMode: effCfg.teamEffortMode || 'auto',
                lockedModelEfforts: effCfg.lockedModelEfforts || {},
                stopped: Boolean(effCfg.stopped || effCfg.paceMode === 'stopped'),
                permissionMode: effCfg.permissionMode || DEFAULT_CHIEF_PERMISSION_MODE,
                capabilities: effCfg.capabilities || {},
                policyPluginsCount: Array.isArray(effCfg.policyPlugins) ? effCfg.policyPlugins.length : 0,
                chiefRiskAcknowledged: Boolean(effCfg.chiefRiskVerified),
                pendingApprovalsCount: ((rootWs && Array.isArray(rootWs.pendingApprovals)) ? rootWs.pendingApprovals : []).filter(a => a && a.status === 'pending').length,
                hasPendingElevation: Boolean(rootWs && rootWs.pendingElevation && rootWs.pendingElevation.status === 'pending'),
                auditLog: ((rootWs && Array.isArray(rootWs.auditLog)) ? rootWs.auditLog : []).slice(-50).reverse(),
                autoPilot: Boolean(effCfg.autoPilot),
                tacticalModes,
                runtimeGuard: (rootWs && rootWs.runtimeGuard) || {},
                flippedCount: flippedIds.length,
                modelRef: pinnedModelRef,
                followModelRef,
                resolvedModelRef: pinnedModelRef || followModelRef || '',
                pendingSuggestions,
                factsCount,
                mailboxCount,
                linkedPeersCount: Math.max(0, cluster.length - 1),
                activeWork: getChiefActiveWork(rootSid),
                contextUsage: sessionId ? getSessionContextBreakdown(runtime, sessionId) : null,
              },
              archiveMeta,
              guardWalls: listGuardWalls({ cwd: sessionArchOpt.cwd }),
            })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/digest',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            let sessionId = ''
            try {
              sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
            } catch {}
            const board = sessionId ? loadBoard(boardFileFor(sessionId)) : emptyBoard()
            const fullBoard = sessionId ? boardForSession(boardFileFor(sessionId)) : board
            const subagents = sessionId ? await refreshSubagentTree(runtime, sessionId, fullBoard) : []
            const agentIdentity = sessionId ? resolveAgentIdentity(runtime, sessionId) : null
            const rootSid = resolveRootSessionId(sessionId) || sessionId
            const linked = linkedPeersForSession(runtime, rootSid)
            const archCtx = collectDigestArchiveContext(runtime, rootSid, fullBoard.activeCabinetId)
            sendJson(res, 200, {
              ok: true,
              digest: renderDigest(fullBoard, {
                subagents,
                agentIdentity,
                teamTasks: sessionId ? fetchTeamTasks(runtime, { id: sessionId }) : undefined,
                takenOutArchives: archCtx.takenOutArchives,
                sessionHookedArchives: archCtx.sessionHookedArchives,
                desktopUsedTokens: archCtx.desktopUsedTokens,
                smartCompactActive: archCtx.smartCompactActive,
                chiefPermissionMode: archCtx.chiefPermissionMode,
                linkedPeersCount: linked.linkedPeersCount,
                linkedPeersProgress: linked.linkedPeersProgress,
              }),
              sessions: board.sessions || {},
              updatedAt: board.updatedAt,
            })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/memory',
        handler: (req, res) => {
          if (!guard(req, res)) return
          let sessionId = ''
          try {
            sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
          } catch {}
          const board = sessionId ? loadBoard(boardFileFor(sessionId)) : emptyBoard()
          sendJson(res, 200, {
            ok: true,
            sections: memorySections(board, 8),
            count: (board.memory || []).length,
            digest: renderMemoryDigest(board, 400),
            settings: board.settings || {},
            updatedAt: board.updatedAt,
          })
        },
      },
      {
        path: API + '/transfer',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const result = await transferChief(runtime, body, typeof body.session === 'string' ? body.session : '')
            sendJson(res, result.ok ? 200 : 400, result)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/sessions',
        handler: (req, res) => {
          if (!guard(req, res)) return
          let sessionId = ''
          try {
            sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
          } catch {}
          const agents = runtime.get('agents')
          const own = loadBoard(boardFileFor(sessionId))
          const shared = loadBoard()
          const fresher = (a, b) => ((a && a.lastSeen) || 0) >= ((b && b.lastSeen) || 0) ? a : b
          const heartbeat = id => {
            const a = (own.sessions || {})[id]
            const b = (shared.sessions || {})[id]
            return fresher(a, b) || {}
          }
          const settings = shared.settings || {}
          const list = agents && typeof agents.list === 'function' ? agents.list() : []
          const archived = safe(() => runtime.get('workspaceRegistry').archivedSessionIds, [])
          const retired = Array.isArray(archived) ? archived : []
          const live = list.filter(agent => {
            const id = String(agent.id)
            return id === sessionId || !retired.includes(id)
          })
          const touched = transcriptTimes()
          sendJson(res, 200, {
            ok: true,
            sessions: live.map(agent => {
              const id = String(agent.id)
              const row = heartbeat(id)
              const seen = row.lastSeen || touched.get(id) || 0
              return {
                id,
                name: sessionName(runtime, agent),
                turns: row.turns || 0,
                lastSeen: seen,
              }
            }),
            archived: retired.length,
            pending: readPending() ? { at: readPending().at, by: readPending().by } : null,
            autoInject: !(settings.autoInject === false),
            guardIdle: !(settings.guardIdle === false),
            guardMaxPerSession: guardCount(settings.guardMaxPerSession, 3, 0, 20),
            guardShortAnswer: guardCount(settings.guardShortAnswer, 600, 0, 10000),
          })
        },
      },
      {
        path: API + '/handoff',
        handler: (req, res) => {
          if (!guard(req, res)) return
          let sessionId = ''
          try {
            sessionId = new URL(req.url || '/', 'http://127.0.0.1').searchParams.get('session') || ''
          } catch {}
          const board = sessionId ? boardForSession(boardFileFor(sessionId)) : emptyBoard()
          const pending = readPending()
          const hInfo = resolveEffectiveHandoff(runtime, sessionId, board)
          sendJson(res, 200, {
            ok: true,
            text: hInfo.text,
            autoText: hInfo.autoText,
            source: hInfo.source,
            isCustom: hInfo.isCustom,
            pinned: hInfo.pinned,
            pinnedAt: hInfo.pinnedAt,
            pinnedBy: hInfo.pinnedBy,
            updatedAt: hInfo.updatedAt,
            handoffAt: hInfo.handoffAt,
            syncOnDigest: hInfo.syncOnDigest,
            isIncomplete: hInfo.isIncomplete,
            isStale: hInfo.isStale,
            hasNarrativeUpdate: hInfo.hasNarrativeUpdate,
            autoInject: !((board.settings || {}).autoInject === false),
            guardIdle: !((board.settings || {}).guardIdle === false),
            pending: pending ? { at: pending.at, by: pending.by, failedTarget: pending.failedTarget || '' } : null,
          })
        },
      },
      {
        path: API + '/action',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = body && typeof body.session === 'string' ? body.session : ''
            const actName = body && typeof body.action === 'string' ? body.action : ''
            if (actName && actName !== 'snapshot') markSessionActivated(sessionId)
            if (actName === 'bounds.propose') {
              const propRes = proposeBoundToChief(makeChiefDeps(runtime), {
                sessionId,
                by: typeof body.by === 'string' ? body.by : 'operator',
                field: normalizeBoundFieldName(body.field) || 'forbidden',
                item: typeof body.item === 'string' ? body.item : (typeof body.text === 'string' ? body.text : ''),
                items: Array.isArray(body.items) ? body.items : undefined,
                reason: typeof body.reason === 'string' ? body.reason : '',
              })
              const board = sessionId ? boardForSession(boardFileFor(sessionId)) : emptyBoard()
              const subagents = sessionId ? await refreshSubagentTree(runtime, sessionId, board) : []
              sendJson(res, propRes.ok ? 200 : 400, {
                ...propRes,
                board,
                subagents,
                boundaries: boundaries(runtime, sessionId),
              })
              return
            }
            if (actName === 'task.dispatch' || actName === 'team.steer' || actName === 'team.interrupt') {
              const subResult = await executeSubagentAction(runtime, body, null)
              sendJson(res, subResult.ok ? 200 : 400, {
                ...subResult,
                boundaries: boundaries(runtime, sessionId),
              })
              return
            }
            const result = runAction({
              ...(body && typeof body === 'object' ? body : {}),
              _callerOrigin: 'human_ui',
              _humanConfirmToken: HUMAN_BOUNDS_CONFIRM_TOKEN,
            })
            const mergedBoard = result.ok && result.board && sessionId
              ? boardForSession(boardFileFor(sessionId))
              : result.board
            const subagents = sessionId && mergedBoard ? await refreshSubagentTree(runtime, sessionId, mergedBoard) : []
            let actionCwd = process.cwd()
            try { actionCwd = archiveTarget(runtime, sessionId, { vaultScope: 'session' }).cwd || actionCwd } catch {}
            sendJson(res, result.ok ? 200 : 400, {
              ...result,
              ...(mergedBoard ? { board: mergedBoard } : {}),
              ...(Array.isArray(result.guardWalls) ? {} : { guardWalls: listGuardWalls({ cwd: actionCwd }) }),
              subagents,
              boundaries: boundaries(runtime, sessionId),
            })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/view',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const url = new URL(req.url || '/', 'http://127.0.0.1')
            let sessionId = url.searchParams.get('session') || ''
            let regenerate = url.searchParams.get('regenerate') === '1'
            const qSync = url.searchParams.get('syncHandoff')
            let syncHandoff = qSync === '1' || qSync === 'true' ? true : (qSync === '0' || qSync === 'false' ? false : undefined)
            if (req.method === 'POST') {
              const body = await readBody(req).catch(() => ({}))
              if (typeof body.session === 'string' && body.session) sessionId = body.session
              if (body.regenerate === true) regenerate = true
              if (typeof body.syncHandoff === 'boolean') syncHandoff = body.syncHandoff
            }
            if (regenerate) markSessionActivated(sessionId)
            const view = await getChiefView(makeChiefDeps(runtime), sessionId, { regenerate, autoSummarize: !regenerate, syncHandoff })
            if (view && view.handoffSyncResult && view.handoffSyncResult.synced && sessionId) {
              sendJson(res, 200, { ...view, board: boardForSession(boardFileFor(sessionId)) })
              return
            }
            sendJson(res, 200, view)
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/ask',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            markSessionActivated(sessionId)
            const out = await askOrCommandChief(makeChiefDeps(runtime), {
              sessionId,
              text: typeof body.text === 'string' ? body.text : '',
              forcedTarget: typeof body.target === 'string' ? body.target : '',
              forcedMode: typeof body.mode === 'string' ? body.mode : 'steer',
              quickAction: typeof body.quickAction === 'string' ? body.quickAction.trim().slice(0, 40) : '',
              images: Array.isArray(body.images) ? body.images : [],
            })
            const board = out.ok && sessionId ? boardForSession(boardFileFor(sessionId)) : undefined
            sendJson(res, out.ok ? 200 : 400, board ? { ...out, board } : out)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/relay-archives',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body?.session === 'string' ? body.session : ''
            const rootSid = resolveRootSessionId(sessionId) || sessionId || 'global'
            markSessionActivated(rootSid)
            const out = await relayArchivesWithChief(makeChiefDeps(runtime), {
              sessionId: rootSid,
              items: Array.isArray(body?.items) ? body.items : [],
              instruction: typeof body?.instruction === 'string' ? body.instruction : '',
              target: typeof body?.target === 'string' ? body.target : 'lead',
              mode: typeof body?.mode === 'string' ? body.mode : 'steer',
              cabinetId: typeof body?.cabinetId === 'string' ? body.cabinetId : '',
            })
            sendJson(res, out && out.ok === false ? 400 : 200, out)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/relay',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            markSessionActivated(sessionId)
            const out = await deliverCrossMessage(makeChiefDeps(runtime), {
              fromSession: sessionId,
              fromLabel: typeof body.by === 'string' && body.by ? body.by : 'DSH 参谋长',
              target: typeof body.target === 'string' ? body.target : 'lead',
              subject: typeof body.subject === 'string' ? body.subject : '',
              text: typeof body.text === 'string' ? body.text : '',
              mode: typeof body.mode === 'string' ? body.mode : 'steer',
              images: Array.isArray(body.images) ? body.images : [],
            })
            const view = await getChiefView(makeChiefDeps(runtime), sessionId, { autoSummarize: false })
            sendJson(res, out.ok ? 200 : 400, { ...out, view })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/models',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const url = new URL(req.url || '/', 'http://127.0.0.1')
            const fresh = url.searchParams.get('fresh') === '1'
            const sessionId = url.searchParams.get('session') || ''
            const catalog = await listChiefModels(makeChiefDeps(runtime), fresh, sessionId)
            sendJson(res, 200, { ok: true, ...catalog })
          } catch (error) {
            sendJson(res, 500, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/config',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body?.session === 'string' ? body.session : ''
            const rootSid = resolveRootSessionId(sessionId) || sessionId || 'global'
            const cleanBody = (body && typeof body === 'object') ? { ...body } : {}
            delete cleanBody._fromUiPanel
            if (cleanBody.toggleLockAgentEffort && typeof cleanBody.toggleLockAgentEffort === 'object') {
              const lkTarget = String(cleanBody.toggleLockAgentEffort.target || 'lead').trim().slice(0, 64)
              const lkVal = Boolean(cleanBody.toggleLockAgentEffort.locked)
              const rawAliases = Array.isArray(cleanBody.toggleLockAgentEffort.aliases)
                ? cleanBody.toggleLockAgentEffort.aliases.map(x => String(x || '').trim().slice(0, 64)).filter(Boolean)
                : []
              const shortT = lkTarget.includes('/') ? lkTarget.split('/').pop() : ''
              const allKeys = Array.from(new Set([lkTarget, shortT, ...rawAliases].filter(Boolean)))
              if (allKeys.length) {
                const nextLocks = {
                  ...((cleanBody.lockedModelEfforts && typeof cleanBody.lockedModelEfforts === 'object') ? cleanBody.lockedModelEfforts : {}),
                }
                for (const k of allKeys) nextLocks[k] = lkVal
                cleanBody.lockedModelEfforts = nextLocks
              }
            }
            const updated = updateChiefConfig({
              ...cleanBody,
              sessionId: rootSid,
              _fromUiPanel: true,
              byUser: true,
              by: 'operator',
            })
            let effortRes = null
            if (updated && updated.ok !== false && body && body.directSetAgentEffort && typeof body.directSetAgentEffort === 'object') {
              const chiefDeps = makeChiefDeps(runtime)
              if (typeof chiefDeps.controlMainAgent === 'function') {
                effortRes = await chiefDeps.controlMainAgent({
                  rootId: rootSid,
                  sessionId: sessionId || rootSid,
                  op: 'set_effort',
                  target: body.directSetAgentEffort.target || 'lead',
                  reasoningEffort: body.directSetAgentEffort.effort || 'medium',
                  reason: '用户从参谋面板手动调节模型思考强度',
                  byUser: true,
                }).catch(err => ({ ok: false, error: String(err && err.message || err) }))
              }
            }
            const wantsInterventionOn = Boolean(body && body.tacticalModes && body.tacticalModes.intervention === true)
            const coreObjDraft = typeof body?.coreObjective === 'string' ? body.coreObjective.trim() : ''
            const targetSessionForBoard = sessionId || (rootSid !== 'global' ? rootSid : '')
            if (updated && updated.ok !== false && wantsInterventionOn && coreObjDraft && targetSessionForBoard) {
              runAction({
                action: 'objective.set',
                objective: coreObjDraft,
                session: targetSessionForBoard,
                by: 'operator',
                _fromInterventionSetup: true,
              })
            }
            if (updated && (updated.emergencyStopped || (updated.config && (updated.config.stopped || updated.config.paceMode === 'stopped')))) {
              if (deps.hostState.activeAutoContinue && typeof deps.hostState.activeAutoContinue.cancelSession === 'function') {
                deps.hostState.activeAutoContinue.cancelSession(sessionId, 'chief stopped')
                if (rootSid && rootSid !== sessionId) deps.hostState.activeAutoContinue.cancelSession(rootSid, 'chief stopped')
              }
            }
            let immediateKickoff = null
            if (updated && updated.ok !== false && wantsInterventionOn && targetSessionForBoard && body && body.startImmediately === true) {
              const boardNow = boardForSession(boardFileFor(targetSessionForBoard))
              const lockedGoal = coreObjDraft || String((boardNow && boardNow.objective) || '').trim()
              const stateNow = loadChiefState()
              const ownWsNow = stateNow.workspaces && stateNow.workspaces[rootSid]
              const cfgNow = resolveWorkspaceConfig(stateNow, rootSid)
              const effectivePerm = normalizePermissionMode(cfgNow.permissionMode || DEFAULT_CHIEF_PERMISSION_MODE, {
                requireAck: true,
                hasChiefRiskAck: hasValidChiefRiskAck(ownWsNow),
              })
              const permRk = permissionRank(effectivePerm)
              const agentsSvc = runtime && typeof runtime.get === 'function' ? runtime.get('agents') : null
              const leadAg = agentsSvc && typeof agentsSvc.get === 'function' ? agentsSvc.get(targetSessionForBoard) : null
              const leadRunning = Boolean(leadAg && leadAg.status === 'running')
              if (lockedGoal && !cfgNow.stopped) {
                const kickoffText = [
                  '【强介入已开启并锁定核心总目标 — 立即开始推进】',
                  `🎯 锁定核心总目标：${lockedGoal}`,
                  '请立即围绕上述已锁定的核心总目标核对当前看板任务与未完成项并直接推进执行（若已有待办先继续推进并在收尾时提交实测验证），无需等待用户再次手动输入“继续”。',
                ].join('\n')
                if (leadRunning) {
                  immediateKickoff = { triggered: false, alreadyRunning: true, mode: effectivePerm }
                } else if (permRk >= 3) {
                  const chiefDeps = makeChiefDeps(runtime)
                  const delivRes = await deliverCrossMessage(chiefDeps, {
                    fromSession: rootSid,
                    fromLabel: 'DSH 参谋长 (强介入锁定目标立即推进)',
                    target: 'lead',
                    subject: '强介入已开启 · 立即围绕总目标推进',
                    text: kickoffText,
                    mode: 'followup',
                    envelopeKind: 'execution_request',
                  }).catch(err => ({ ok: false, error: String(err && err.message || err) }))
                  mutateChiefState((st) => {
                    const ws = ensureWorkspace(st, rootSid)
                    ws.chat.push({
                      id: nextId('chat'),
                      role: 'chief',
                      kind: 'receipt',
                      text: `- 【⚡ 强介入已锁定目标并立即推进】已自动向 \`@lead\` 下发首轮推进请求\n- 【🎯 锁定总目标】${lockedGoal.slice(0, 180)}`,
                      actions: [delivRes && delivRes.ok ? '⚡ 已立即唤醒推进' : '⚠️ 唤醒未送达'],
                      at: Date.now(),
                    })
                    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
                  })
                  immediateKickoff = { triggered: Boolean(delivRes && delivRes.ok), mode: effectivePerm }
                } else if (permRk === 2) {
                  queueChiefApproval(rootSid, {
                    category: 'main_workflow',
                    operationLabel: '强介入开启 · 立即唤醒主对话推进',
                    targetLabel: '主对话 (@lead)',
                    reason: '强介入已锁定核心总目标，按 L2 参谋模式请您一键放行首轮推进执行请求（之后无需手动发“继续”）',
                    impact: '允许后立即向 @lead 投递首轮强介入推进指令',
                    preview: lockedGoal.slice(0, 220),
                    kind: 'relay',
                    capabilityScope: buildCapabilityScope({ kind: 'relay', tool: 'relay', target: 'lead' }),
                    payload: {
                      fromSession: rootSid,
                      fromLabel: 'DSH 参谋 (强介入锁定目标立即推进)',
                      target: 'lead',
                      subject: '强介入已开启 · 立即推进',
                      text: kickoffText,
                      mode: 'followup',
                      envelopeKind: 'execution_request',
                    },
                    by: 'chief',
                  })
                  immediateKickoff = { triggered: false, queuedApproval: true, mode: effectivePerm }
                } else {
                  mutateChiefState((st) => {
                    const ws = ensureWorkspace(st, rootSid)
                    const sug = normalizeSuggestion({
                      kind: 'relay',
                      fromAgent: '⚡ 强介入首轮就绪',
                      title: '立即向主对话发首轮强介入推进指令',
                      reason: `已锁定核心总目标并开启强介入（当前 ${effectivePerm === 'assistant' ? 'L1 助手档' : 'L0 顾问档'}，无权直改主对话工作流；升至 L2/L3 即可全自动推跑）。`,
                      target: 'lead',
                      targetLabel: '主对话 (@lead)',
                      mode: 'followup',
                      draftText: kickoffText,
                    })
                    if (sug) {
                      ws.suggestions.push(sug)
                      if (ws.suggestions.length > SUGGESTIONS_CAP) ws.suggestions = ws.suggestions.slice(-SUGGESTIONS_CAP)
                    }
                    ws.chat.push({
                      id: nextId('chat'),
                      role: 'chief',
                      kind: 'receipt',
                      text: `- 【⚡ 强介入已锁定核心总目标（当前 ${effectivePerm === 'assistant' ? 'L1' : 'L0'} 仅监督待命）】已生成首轮推进建议，升至 L2/L3 即可直接自动推动 \`@lead\`。\n- 【🎯 锁定总目标】${lockedGoal.slice(0, 180)}`,
                      actions: ['🎯 目标已锁定'],
                      at: Date.now(),
                    })
                    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
                  })
                  immediateKickoff = { triggered: false, queuedSuggestion: true, mode: effectivePerm }
                }
              }
            }
            const cfgActive = updated && updated.config ? updated.config : null
            const switchedToActiveRunOrIntv = Boolean(
              wantsInterventionOn
              || body?.runMode === 'managed'
              || body?.runMode === 'patrol'
              || body?.paceMode === 'auto'
              || body?.paceMode === 'smart'
              || body?.autoPilot === true,
            )
            if (
              updated
              && updated.ok !== false
              && targetSessionForBoard
              && !(immediateKickoff && immediateKickoff.triggered)
              && cfgActive
              && !cfgActive.stopped
              && cfgActive.tacticalModes
              && cfgActive.tacticalModes.intervention === true
              && switchedToActiveRunOrIntv
            ) {
              const agentsSvcNow = runtime && typeof runtime.get === 'function' ? runtime.get('agents') : null
              const leadAgNow = agentsSvcNow && typeof agentsSvcNow.get === 'function' ? agentsSvcNow.get(targetSessionForBoard) : null
              if (leadAgNow && leadAgNow.status !== 'running') {
                scheduleChiefTurnReview(makeChiefDeps(runtime), {
                  agent: leadAgNow,
                  sessionId: targetSessionForBoard,
                  abnormalTrigger: 'config_activated',
                })
              }
            }
            const view = await getChiefView(makeChiefDeps(runtime), sessionId, { autoSummarize: false })
            const latestBoard = targetSessionForBoard ? boardForSession(boardFileFor(targetSessionForBoard)) : null
            const curChiefName = (updated && updated.config && typeof updated.config.chiefName === 'string')
              ? updated.config.chiefName
              : (resolveWorkspaceConfig(loadChiefState(), rootSid).chiefName || '')
            sendJson(res, updated && updated.ok === false ? 400 : 200, {
              ...updated,
              chiefName: curChiefName,
              ...(updated && updated.config
                ? { config: { ...updated.config, chiefName: curChiefName } }
                : {}),
              ...(effortRes ? { effortRes } : {}),
              ...(immediateKickoff ? { immediateKickoff } : {}),
              ...(latestBoard ? { board: latestBoard } : {}),
              view,
            })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/approval',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body?.session === 'string' ? body.session : ''
            markSessionActivated(sessionId)
            const out = await handleApprovalDecision(makeChiefDeps(runtime), {
              sessionId,
              approvalId: typeof body?.id === 'string' ? body.id : '',
              decision: body?.decision === 'approve' ? 'approve' : 'reject',
              reason: typeof body?.reason === 'string' ? body.reason : '',
            })
            const board = out.ok && sessionId ? boardForSession(boardFileFor(sessionId)) : undefined
            sendJson(res, out.ok ? 200 : 400, board ? { ...out, board } : out)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/elevation',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body?.session === 'string' ? body.session : ''
            markSessionActivated(sessionId)
            const out = await handleElevationDecision(makeChiefDeps(runtime), {
              sessionId,
              elevationId: typeof body?.id === 'string' ? body.id : '',
              decision: body?.decision === 'approve' ? 'approve' : 'reject',
              targetMode: typeof body?.targetMode === 'string' ? body.targetMode : '',
              confirmedChiefRisk: Boolean(body?.confirmedChiefRisk),
            })
            const board = sessionId ? boardForSession(boardFileFor(sessionId)) : undefined
            sendJson(res, out.ok ? 200 : 400, board ? { ...out, board } : out)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/suggest-objective',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req).catch(() => ({}))
            const sessionId = typeof body?.session === 'string' ? body.session : ''
            markSessionActivated(sessionId)
            const out = await suggestCoreObjectiveWithChief(makeChiefDeps(runtime), {
              sessionId,
              draft: typeof body?.draft === 'string' ? body.draft : '',
              mode: typeof body?.mode === 'string' ? body.mode : 'auto',
              previousSuggestions: Array.isArray(body?.previousSuggestions) ? body.previousSuggestions : [],
            })
            sendJson(res, out && out.ok === false ? 400 : 200, out)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/recommend-compact',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req).catch(() => ({}))
            const sessionId = typeof body?.session === 'string' ? body.session : ''
            markSessionActivated(sessionId)
            const out = await recommendAndSetCompactThreshold(makeChiefDeps(runtime), { sessionId })
            sendJson(res, out && out.ok === false ? 400 : 200, out)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/link',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            const rootA = resolveRootSessionId(sessionId) || sessionId
            const op = typeof body.op === 'string' ? body.op.trim() : ''
            const chiefDeps = makeChiefDeps(runtime)

            if (op === 'bubble_refresh') {
              refreshBubbleDiscovery(runtime, deps.hostState)
              const view = await getChiefView(chiefDeps, rootA, { autoSummarize: false })
              const bNow = (view && view.bubble) || {}
              const totalHarnesses = ((bNow.enrolledHarnesses || []).filter(h => h && h.installed !== false).length)
                + ((bNow.availableHarnesses || []).length)
              const otherList = Array.isArray(view && view.otherSessions) ? view.otherSessions : []
              sendJson(res, 200, {
                ok: true,
                refreshed: {
                  harnesses: totalHarnesses,
                  otherSessions: otherList.length,
                  dormantSessions: otherList.filter(s => s && s.dormant).length,
                },
                view,
              })
              return
            }

            markSessionActivated(rootA)
            const dirNow = await listPeerDirectory(chiefDeps, rootA).catch(() => ({ targets: [], cluster: [] }))
            const bState = computeBubbleState(chiefDeps, rootA, loadChiefState(), dirNow)
            const LOCK_ERR = '🔒 协同水泡工作中已锁死结构，不允许中途拆解或改动编队；请等待全员收工或点击「⏹ 急停解体」'

            if (op === 'bubble_emergency_stop') {
              const subagents = runtime && typeof runtime.get === 'function' ? runtime.get('subagents') : null
              let stoppedCount = 0
              if (deps.hostState.activeBubbleRuns instanceof Map) {
                for (const [rKey, run] of [...deps.hostState.activeBubbleRuns.entries()]) {
                  if (!run || (run.rootId && run.rootId !== rootA)) continue
                  try { run.abortController?.abort() } catch {}
                  try { if (typeof run.terminate === 'function') run.terminate() } catch {}
                  try {
                    if (run.childId && subagents && typeof subagents.interrupt === 'function') {
                      subagents.interrupt(run.childId, { kind: 'user' })
                    }
                  } catch {}
                  deps.hostState.activeBubbleRuns.delete(rKey)
                  stoppedCount += 1
                }
              }
              if (subagents && typeof subagents.interrupt === 'function') {
                for (const peer of (dirNow.targets || [])) {
                  if (peer && peer.status === 'running' && peer.id && (peer.kind === 'subagent' || peer.kind === 'peer-session')) {
                    try {
                      subagents.interrupt(peer.id, { kind: 'user' })
                      stoppedCount += 1
                    } catch {}
                  }
                }
              }
              try {
                deps.hostState.activeAutoContinue?.cancelSession?.(rootA, 'bubble emergency stop')
              } catch {}
              try {
                updateChiefConfig(chiefDeps, {
                  session: rootA,
                  tacticalModes: { intervention: false },
                  byUser: true,
                })
              } catch {}
              setBubbleManualLock(rootA, { locked: false, reason: 'emergency_stop' })
              appendChiefAuditLog(rootA, {
                kind: 'bubble_emergency_stop',
                decision: 'allowed',
                tool: 'bubble_emergency_stop',
                reason: `触发水泡急停解体，终止 ${stoppedCount} 个在途成员并释放结构锁`,
              })
              mutateChiefState((st) => {
                const ws = ensureWorkspace(st, rootA)
                ws.chat.push({
                  id: nextId('chat'),
                  role: 'chief',
                  kind: 'receipt',
                  text: `- 【⏹ 水泡急停解体】已中断 ${stoppedCount} 个在途执行并解除协同编队锁死。`,
                  actions: ['🔓 结构已解锁'],
                  at: Date.now(),
                })
                if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
              })
              const view = await getChiefView(chiefDeps, rootA, { autoSummarize: false })
              sendJson(res, 200, { ok: true, stoppedCount, view })
              return
            }

            if (op === 'bubble_lock') {
              const wantLock = Boolean(body.locked)
              if (!wantLock && bState.autoLocked) {
                sendJson(res, 409, {
                  ok: false,
                  locked: true,
                  error: '🔒 仍有成员或外部 Harness 运行中，无法直接解锁；请等待完结或点击「⏹ 急停解体」',
                  bubble: bState,
                })
                return
              }
              const lockRes = setBubbleManualLock(rootA, {
                locked: wantLock,
                reason: typeof body.reason === 'string' ? body.reason : '',
              })
              if (!lockRes.ok) {
                sendJson(res, 400, lockRes)
                return
              }
              const view = await getChiefView(chiefDeps, rootA, { autoSummarize: false })
              sendJson(res, 200, { ...lockRes, view })
              return
            }

            if (op === 'harness_toggle') {
              if (bState.locked && body.force !== true) {
                sendJson(res, 409, { ok: false, locked: true, error: LOCK_ERR, bubble: bState })
                return
              }
              const hRes = setBubbleHarnessMembership(rootA, {
                provider: body.provider,
                label: body.label,
                role: body.role,
                joined: Boolean(body.joined),
              })
              if (!hRes.ok) {
                sendJson(res, 400, hRes)
                return
              }
              const view = await getChiefView(chiefDeps, rootA, { autoSummarize: false })
              sendJson(res, 200, { ...hRes, view })
              return
            }

            if (op === 'harness_dispatch') {
              const provider = clamp(String(body.provider || '').trim(), 64)
              const taskText = typeof body.text === 'string' ? body.text.trim() : ''
              const taskLabel = clamp(String(body.label || taskText || provider).trim(), 48)
              const rawChain = body.chainNext && typeof body.chainNext === 'object' ? body.chainNext : null
              const chainNext = rawChain && rawChain.provider
                ? { provider: clamp(String(rawChain.provider).trim(), 64), instruction: clamp(String(rawChain.instruction || '').trim(), 600) }
                : null
              const disp = await dispatchBubbleHarness(chiefDeps, {
                rootId: rootA,
                provider,
                text: taskText,
                label: taskLabel,
                fromLabel: resolveWorkspaceConfig(loadChiefState(), rootA).chiefName || 'DSH 参谋长',
                force: body.force === true,
                allowAutoEnroll: true,
                chainNext,
              })
              if (!disp.ok) {
                const status = disp.statusCode || (disp.locked ? 409 : 400)
                sendJson(res, status, disp)
                return
              }
              const view = await getChiefView(chiefDeps, rootA, { autoSummarize: false })
              sendJson(res, 200, { ok: true, runId: disp.runId, childId: disp.childId, transport: disp.transport, view })
              return
            }

            if (bState.locked && body.force !== true) {
              sendJson(res, 409, { ok: false, locked: true, error: LOCK_ERR, bubble: bState })
              return
            }
            const peerSession = typeof body.peerSession === 'string' ? body.peerSession : ''
            const rootB = resolveRootSessionId(peerSession) || peerSession
            const linked = Boolean(body.linked)
            const out = setPeerLink(rootA, rootB, linked)
            if (!out.ok) {
              sendJson(res, 400, out)
              return
            }
            const view = await getChiefView(chiefDeps, rootA, { autoSummarize: false })
            sendJson(res, 200, { ...out, view })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/suggestion',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            markSessionActivated(sessionId)
            const isBatch = body.decision === 'execute_batch' || body.batch === true
            const out = isBatch
              ? await executeBatchSuggestions(makeChiefDeps(runtime), {
                  sessionId,
                  ids: Array.isArray(body.ids) ? body.ids : [],
                  includeGoalApproval: Boolean(body.includeGoalApproval),
                  pinGlobalDefault: typeof body.pinGlobal === 'boolean'
                    ? body.pinGlobal
                    : (typeof body.pinGlobalDefault === 'boolean' ? body.pinGlobalDefault : undefined),
                })
              : await handleSuggestionDecision(makeChiefDeps(runtime), {
                  sessionId,
                  suggestionId: typeof body.id === 'string' ? body.id : '',
                  decision: body.decision === 'approve' ? 'approve' : 'dismiss',
                  editedText: typeof body.text === 'string' ? body.text : '',
                  boundField: typeof body.boundField === 'string' ? body.boundField : '',
                  pinGlobal: typeof body.pinGlobal === 'boolean' ? body.pinGlobal : undefined,
                })
            const board = out.ok && sessionId ? boardForSession(boardFileFor(sessionId)) : undefined
            sendJson(res, out.ok ? 200 : 400, board ? { ...out, board } : out)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/consolidate-bounds',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            markSessionActivated(sessionId)
            const out = await consolidateBoundsWithChief(makeChiefDeps(runtime), {
              sessionId,
              field: typeof body.field === 'string' ? body.field : '',
              items: Array.isArray(body.items) ? body.items : [],
              instruction: typeof body.instruction === 'string' ? body.instruction : '',
            })
            const board = sessionId ? boardForSession(boardFileFor(sessionId)) : undefined
            sendJson(res, out.ok ? 200 : 400, board ? { ...out, board } : out)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/chief/fact',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            const rawOp = typeof body.op === 'string' ? body.op : 'add'
            if (rawOp === 'github.star_status' || rawOp === 'github.star_toggle') {
              const subSvc = (runtime && typeof runtime.get === 'function' ? runtime.get('subprocess') : null)
                || (deps && deps.hostState && deps.hostState.activeSubprocess)
                || null
              const out = rawOp === 'github.star_status'
                ? await getGithubStarStatus({
                    subprocessSvc: subSvc,
                    checkPersonal: Boolean(body.checkPersonal),
                    force: Boolean(body.force),
                  })
                : await toggleGithubStar({
                    subprocessSvc: subSvc,
                    desired: typeof body.desired === 'boolean' ? body.desired : null,
                  })
              sendJson(res, out && out.ok === false ? 400 : 200, out)
              return
            }
            markSessionActivated(sessionId)
            const out = mutateChiefFact(makeChiefDeps(runtime), {
              sessionId,
              op: rawOp,
              id: typeof body.id === 'string' ? body.id : '',
              text: typeof body.text === 'string' ? body.text : '',
              category: typeof body.category === 'string' ? body.category : 'discipline',
              pinned: Boolean(body.pinned),
            })
            if (!out.ok) {
              sendJson(res, 400, out)
              return
            }
            const view = await getChiefView(makeChiefDeps(runtime), sessionId, { autoSummarize: false })
            sendJson(res, 200, { ...out, view })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/archives',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const url = new URL(req.url || '/', 'http://127.0.0.1')
            if (req.method === 'GET' || !req.method) {
              const sessionId = url.searchParams.get('session') || ''
              const rootSid = resolveBoundRootSid(sessionId)
              const query = url.searchParams.get('q') || ''
              const folder = url.searchParams.get('folder') || ''
              const paperclip = url.searchParams.get('paperclip') || ''
              const reqScope = resolveArchiveHttpScope(url.searchParams.get('scope') || url.searchParams.get('vaultScope') || '')
              const workingScope = reqScope === 'global' ? 'global' : 'session'
              const cabinetId = workingScope === 'global' ? '' : (url.searchParams.get('cabinetId') || '')
              const targetOpt = archiveTarget(runtime, rootSid, { cabinetId, vaultScope: workingScope })
              const st = loadChiefState()
              const ws = rootSid && st.workspaces ? st.workspaces[rootSid] : null
              const flippedIds = (ws && Array.isArray(ws.flippedPrecipitatedIds)) ? ws.flippedPrecipitatedIds.slice() : []
              const out = listArchiveHeaders(rootSid, {
                query,
                folder,
                paperclip,
                vaultScope: workingScope,
                includePrecipitated: true,
                flippedIds,
              }, targetOpt)
              sendJson(res, 200, {
                ...out,
                requestedScope: reqScope,
                flippedPrecipitatedIds: flippedIds,
                deskItems: collectDeskItemsForUi(runtime, rootSid, cabinetId),
                counts: out.counts || getThreeTierArchiveCounts(rootSid, flippedIds, targetOpt),
                archiveMeta: getArchiveMeta(rootSid, targetOpt),
              })
              return
            }

            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            const rootSid = resolveBoundRootSid(sessionId)
            markSessionActivated(rootSid || sessionId)
            const op = typeof body.op === 'string' ? body.op : 'save'
            const reqScope = resolveArchiveHttpScope(body.vaultScope || body.scope || '')
            const workingScope = reqScope === 'global' ? 'global' : 'session'
            const cabinetId = workingScope === 'global' ? '' : (typeof body.cabinetId === 'string' ? body.cabinetId : '')
            const targetOpt = archiveTarget(runtime, rootSid, { cabinetId, vaultScope: workingScope })
            const projectKey = resolveProjectKey(targetOpt.cwd)

            if (['flipOut', 'sealBack', 'deletePrecipitated', 'updatePrecipitated'].includes(op)) {
              const pid = typeof body.id === 'string' ? body.id : (typeof body.precipitatedId === 'string' ? body.precipitatedId : '')
              const pRes = mutatePrecipitated(projectKey, {
                ...body,
                id: pid,
                precipitatedId: pid,
                op,
                rootSessionId: rootSid,
              }, targetOpt)
              if (!pRes.ok) {
                sendJson(res, 400, pRes)
                return
              }
              if (rootSid) {
                if (op === 'flipOut' && pid) updateWorkspaceFlippedIds(rootSid, { flippedId: pid })
                else if ((op === 'sealBack' || op === 'deletePrecipitated') && pid) updateWorkspaceFlippedIds(rootSid, { sealId: pid })
              }
              const stAfter = loadChiefState()
              const wsAfter = rootSid && stAfter.workspaces ? stAfter.workspaces[rootSid] : null
              const flippedAfter = (wsAfter && Array.isArray(wsAfter.flippedPrecipitatedIds)) ? wsAfter.flippedPrecipitatedIds.slice() : []
              const archives = listArchiveHeaders(rootSid, { vaultScope: workingScope, includePrecipitated: true, flippedIds: flippedAfter }, targetOpt)
              sendJson(res, 200, {
                ...pRes,
                archives,
                deskItems: collectDeskItemsForUi(runtime, rootSid, cabinetId),
                counts: archives.counts || getThreeTierArchiveCounts(rootSid, flippedAfter, targetOpt),
                flippedPrecipitatedIds: flippedAfter,
                archiveMeta: getArchiveMeta(rootSid, targetOpt),
              })
              return
            }

            if (op === 'pullPrecipitated') {
              const pid = typeof body.id === 'string' ? body.id : (typeof body.precipitatedId === 'string' ? body.precipitatedId : '')
              const targetScope = resolveArchiveHttpScope(body.targetScope || body.toScope || 'session') === 'global' ? 'global' : 'session'
              const copyRes = copyPrecipitatedToVault(projectKey, {
                ...body,
                id: pid,
                precipitatedId: pid,
                targetScope,
                rootSessionId: rootSid,
              }, targetOpt)
              if (!copyRes.ok) {
                sendJson(res, 400, copyRes)
                return
              }
              const stAfter = loadChiefState()
              const wsAfter = rootSid && stAfter.workspaces ? stAfter.workspaces[rootSid] : null
              const flippedAfter = (wsAfter && Array.isArray(wsAfter.flippedPrecipitatedIds)) ? wsAfter.flippedPrecipitatedIds.slice() : []
              const archives = listArchiveHeaders(rootSid, { vaultScope: workingScope, includePrecipitated: true, flippedIds: flippedAfter }, targetOpt)
              sendJson(res, 200, {
                ...copyRes,
                archives,
                deskItems: collectDeskItemsForUi(runtime, rootSid, cabinetId),
                counts: archives.counts || getThreeTierArchiveCounts(rootSid, flippedAfter, targetOpt),
                flippedPrecipitatedIds: flippedAfter,
                archiveMeta: getArchiveMeta(rootSid, targetOpt),
              })
              return
            }

            if (op === 'precipitateNotes') {
              // Sweep active board.notes (session / rootSession / matched shared notes) into active working cabinet
              const NOTE_SWEEP_SECRET_RE = /(?:sk-[a-zA-Z0-9_-]{16,}|ghp_[a-zA-Z0-9]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|Bearer\s+[A-Za-z0-9._~+/=-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|-----BEGIN [A-Z ]*PRIVATE KEY-----)/g
              const noteIds = Array.isArray(body.noteIds) && body.noteIds.length > 0
                ? new Set(body.noteIds.map(String))
                : null
              let sweptCount = 0
              const sweptIds = new Set()
              const savedFolders = new Set()
              let lastCabId = ''

              const saveNoteIntoArchive = (note) => {
                const paperclip = (note.pinned || (note.tags || []).includes('anchor')) ? 'gold' : undefined
                const basePayload = {
                  op: 'save',
                  vaultScope: workingScope,
                  sourceNoteId: note.id,
                  title: note.title,
                  body: note.body,
                  tags: note.tags,
                  paperclip,
                  by: note.by || 'user',
                  rootSessionId: rootSid,
                }
                let saved = mutateArchive(basePayload, targetOpt)
                if (!saved.ok && typeof saved.error === 'string' && /秘钥|凭据|密钥|SECRET|Token/i.test(saved.error)) {
                  const redactedTitle = String(note.title || '').replace(NOTE_SWEEP_SECRET_RE, '[REDACTED]')
                  const redactedBody = String(note.body || '').replace(NOTE_SWEEP_SECRET_RE, '[REDACTED]')
                  saved = mutateArchive({
                    ...basePayload,
                    title: redactedTitle,
                    body: redactedBody,
                  }, targetOpt)
                }
                return saved
              }

              const sweepFromFile = (targetFile, { allowUnfiltered = true } = {}) => {
                if (!targetFile || !fs.existsSync(targetFile)) return
                withBoardLock(targetFile, () => {
                  const b = loadBoard(targetFile)
                  if (!Array.isArray(b.notes) || !b.notes.length) return
                  const keep = []
                  let fileSwept = 0
                  let changed = false
                  for (const note of b.notes) {
                    if (!note || !note.id) {
                      keep.push(note)
                      continue
                    }
                    if (sweptIds.has(note.id)) {
                      changed = true
                      continue
                    }
                    if (noteIds) {
                      if (!noteIds.has(note.id)) {
                        keep.push(note)
                        continue
                      }
                    } else if (!allowUnfiltered && (note.pinned || (Array.isArray(note.tags) && note.tags.includes('anchor')))) {
                      keep.push(note)
                      continue
                    }
                    const saved = saveNoteIntoArchive(note)
                    if (saved.ok) {
                      sweptCount += 1
                      fileSwept += 1
                      changed = true
                      sweptIds.add(note.id)
                      if (saved.item && saved.item.folder) savedFolders.add(saved.item.folder)
                      const cab = (saved.meta && saved.meta.activeCabinetId) || saved.activeCabinetId || saved.cabinetId || ''
                      if (cab) lastCabId = cab
                    } else {
                      keep.push(note)
                    }
                  }
                  if (changed) {
                    b.notes = keep
                    if (fileSwept > 0) {
                      pushLog(b, `🗄️ 已将 ${fileSwept} 篇便签收纳进「${workingScope === 'global' ? '全局' : '本会话'}档案柜」`, 'operator', sessionId)
                    }
                    saveBoard(b, targetFile)
                  }
                })
              }

              if (sessionId) {
                const candidateFiles = []
                const addFile = (f, allowUnfiltered) => {
                  if (!f) return
                  const norm = path.resolve(f)
                  if (!candidateFiles.some(x => x.norm === norm)) {
                    candidateFiles.push({ file: f, norm, allowUnfiltered })
                  }
                }
                addFile(boardFileFor(sessionId), true)
                if (rootSid && rootSid !== sessionId) addFile(boardFileFor(rootSid), true)
                for (const cand of candidateFiles) {
                  sweepFromFile(cand.file, { allowUnfiltered: cand.allowUnfiltered })
                }
                if ((noteIds && sweptIds.size < noteIds.size) || sweptCount === 0) {
                  sweepFromFile(boardFile(), { allowUnfiltered: false })
                }
              } else {
                sweepFromFile(boardFile(), { allowUnfiltered: true })
              }

              if (rootSid && workingScope !== 'global' && lastCabId) {
                const bFile = boardFileFor(rootSid)
                withBoardLock(bFile, () => {
                  const b = loadBoard(bFile)
                  if (!b.activeCabinetId) {
                    b.activeCabinetId = lastCabId
                    saveBoard(b, bFile)
                  }
                })
              }

              const finalOpt = archiveTarget(runtime, rootSid || sessionId, {
                cabinetId: lastCabId || cabinetId,
                vaultScope: workingScope,
              })
              const stNow = loadChiefState()
              const wsNow = rootSid && stNow.workspaces ? stNow.workspaces[rootSid] : null
              const flippedNow = (wsNow && Array.isArray(wsNow.flippedPrecipitatedIds)) ? wsNow.flippedPrecipitatedIds.slice() : []
              const board = sessionId ? boardForSession(boardFileFor(sessionId)) : boardForSession(boardFile())
              const archives = listArchiveHeaders(rootSid, { vaultScope: workingScope, includePrecipitated: true, flippedIds: flippedNow }, finalOpt)
              sendJson(res, 200, {
                ok: true,
                sweptCount,
                savedFolders: [...savedFolders],
                board,
                archives,
                deskItems: collectDeskItemsForUi(runtime, rootSid, lastCabId || cabinetId || ''),
                counts: archives.counts || getThreeTierArchiveCounts(rootSid, flippedNow, finalOpt),
                archiveMeta: getArchiveMeta(rootSid, finalOpt),
              })
              return
            }

            const out = mutateArchive({
              ...body,
              vaultScope: workingScope,
              op,
              rootSessionId: rootSid,
            }, targetOpt)
            if (!out.ok) {
              sendJson(res, 400, out)
              return
            }
            const isCrossCopy = op === 'copyToGlobal' || op === 'copyToSession'
            const usedCabId = out.activeCabinetId || out.cabinetId || ''
            if (rootSid && workingScope !== 'global' && !isCrossCopy && usedCabId && op !== 'listCabinets') {
              const bFile = boardFileFor(rootSid)
              withBoardLock(bFile, () => {
                const b = loadBoard(bFile)
                if (op === 'switchCabinet' || op === 'createCabinet' || !b.activeCabinetId) {
                  b.activeCabinetId = usedCabId
                  saveBoard(b, bFile)
                }
              })
            }
            const stNow = loadChiefState()
            const wsNow = rootSid && stNow.workspaces ? stNow.workspaces[rootSid] : null
            const flippedNow = (wsNow && Array.isArray(wsNow.flippedPrecipitatedIds)) ? wsNow.flippedPrecipitatedIds.slice() : []
            const finalOpt = isCrossCopy
              ? targetOpt
              : archiveTarget(runtime, rootSid || sessionId, { cabinetId: out.activeCabinetId || cabinetId || out.cabinetId, vaultScope: workingScope })
            const archives = listArchiveHeaders(rootSid, { vaultScope: workingScope, includePrecipitated: true, flippedIds: flippedNow }, finalOpt)
            const board = sessionId ? boardForSession(boardFileFor(sessionId)) : undefined
            sendJson(res, 200, {
              ...out,
              archives,
              deskItems: collectDeskItemsForUi(runtime, rootSid, out.activeCabinetId || cabinetId || out.cabinetId || ''),
              diffSummary: out.diffSummary || archives.diffSummary,
              counts: out.counts || archives.counts || getThreeTierArchiveCounts(rootSid, flippedNow, finalOpt),
              ...(board ? { board } : {}),
              archiveMeta: getArchiveMeta(rootSid, finalOpt),
            })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/archives/detail',
        handler: (req, res) => {
          if (!guard(req, res)) return
          try {
            const url = new URL(req.url || '/', 'http://127.0.0.1')
            const id = url.searchParams.get('id') || ''
            const sessionId = url.searchParams.get('session') || ''
            const reqScope = resolveArchiveHttpScope(url.searchParams.get('scope') || url.searchParams.get('vaultScope') || '')
            const cabinetId = reqScope === 'global' ? '' : (url.searchParams.get('cabinetId') || '')
            const isPrecip = url.searchParams.get('precipitated') === '1' || url.searchParams.get('precipitated') === 'true' || reqScope === 'precipitated'
            const rootSid = resolveBoundRootSid(sessionId)
            const targetOpt = archiveTarget(runtime, rootSid, { cabinetId, vaultScope: reqScope === 'global' ? 'global' : 'session' })
            const out = isPrecip
              ? getPrecipitatedDetail(resolveProjectKey(targetOpt.cwd), id, rootSid, targetOpt)
              : getArchiveDetail(id, rootSid, targetOpt)
            sendJson(res, out.ok ? 200 : 404, out)
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/archives/organize',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            const rootSid = resolveBoundRootSid(sessionId)
            markSessionActivated(rootSid || sessionId)
            const vaultScope = resolveArchiveHttpScope(body.vaultScope || body.scope) === 'global' ? 'global' : 'session'
            const cabinetId = vaultScope === 'global' ? '' : (typeof body.cabinetId === 'string' ? body.cabinetId : '')
            const targetOpt = archiveTarget(runtime, rootSid, { cabinetId, vaultScope })
            const out = await organizeArchivesWithChief(makeChiefDeps(runtime), {
              sessionId: rootSid || 'global',
              vaultScope,
              cabinetId,
              ids: Array.isArray(body.ids) ? body.ids : [],
              folder: typeof body.folder === 'string' ? body.folder : '',
              scope: typeof body.scope === 'string' ? body.scope : 'unorganized',
              instruction: typeof body.instruction === 'string' ? body.instruction : '',
              ...(typeof body.reasonKind === 'string' && body.reasonKind ? { reasonKind: body.reasonKind } : {}),
            })
            const stNow = loadChiefState()
            const wsNow = rootSid && stNow.workspaces ? stNow.workspaces[rootSid] : null
            const flippedNow = (wsNow && Array.isArray(wsNow.flippedPrecipitatedIds)) ? wsNow.flippedPrecipitatedIds.slice() : []
            sendJson(res, out.ok ? 200 : 400, {
              ...out,
              counts: getThreeTierArchiveCounts(rootSid, flippedNow, targetOpt),
              archiveMeta: getArchiveMeta(rootSid, targetOpt),
            })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/archives/distill-to-global',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            const rootSid = resolveBoundRootSid(sessionId)
            if (!rootSid) {
              sendJson(res, 400, { ok: false, error: '当前未绑定具体会话，无法从本会话档案柜提炼' })
              return
            }
            markSessionActivated(rootSid)
            const cabinetId = typeof body.cabinetId === 'string' ? body.cabinetId : ''
            const targetOpt = archiveTarget(runtime, rootSid, { cabinetId, vaultScope: 'session' })
            const out = await distillSessionArchivesToGlobal(makeChiefDeps(runtime), {
              sessionId: rootSid,
              cabinetId,
              ids: Array.isArray(body.ids) ? body.ids : null,
              folder: typeof body.folder === 'string' ? body.folder : '',
              clearSource: Boolean(body.clearSource),
              instruction: typeof body.instruction === 'string' ? body.instruction : '',
            })
            const stNow = loadChiefState()
            const wsNow = stNow.workspaces ? stNow.workspaces[rootSid] : null
            const flippedNow = (wsNow && Array.isArray(wsNow.flippedPrecipitatedIds)) ? wsNow.flippedPrecipitatedIds.slice() : []
            sendJson(res, out.ok ? 200 : 400, {
              ...out,
              deskItems: collectDeskItemsForUi(runtime, rootSid, cabinetId),
              counts: getThreeTierArchiveCounts(rootSid, flippedNow, targetOpt),
              archiveMeta: getArchiveMeta(rootSid, targetOpt),
            })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/archives/harvest',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            const rootSid = resolveBoundRootSid(sessionId)
            markSessionActivated(rootSid || sessionId)
            const cabinetId = typeof body.cabinetId === 'string' ? body.cabinetId : ''
            const vaultScope = 'session'
            const targetOpt = archiveTarget(runtime, rootSid, { cabinetId, vaultScope })
            const out = await harvestTurnDetailsToArchive(makeChiefDeps(runtime), {
              sessionId: rootSid,
              vaultScope,
              cabinetId,
              trigger: 'manual',
              focusHint: typeof body.focusHint === 'string' ? body.focusHint : '',
            })
            const stNow = loadChiefState()
            const wsNow = rootSid && stNow.workspaces ? stNow.workspaces[rootSid] : null
            const flippedNow = (wsNow && Array.isArray(wsNow.flippedPrecipitatedIds)) ? wsNow.flippedPrecipitatedIds.slice() : []
            sendJson(res, out.ok ? 200 : 400, {
              ...out,
              counts: getThreeTierArchiveCounts(rootSid, flippedNow, targetOpt),
              archiveMeta: getArchiveMeta(rootSid, targetOpt),
            })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
      {
        path: API + '/archives/precipitate',
        handler: async (req, res) => {
          if (!guard(req, res)) return
          try {
            const body = await readBody(req)
            const sessionId = typeof body.session === 'string' ? body.session : ''
            const rootSid = resolveRootSessionId(sessionId) || sessionId
            markSessionActivated(rootSid)
            const cabinetId = typeof body.cabinetId === 'string' ? body.cabinetId : ''
            const vaultScope = resolveArchiveHttpScope(body.vaultScope || body.scope) === 'global' ? 'global' : 'session'
            if (vaultScope !== 'global') {
              sendJson(res, 400, { ok: false, error: '实行三级梯度制度：本会话档案请先升级入「🌐 全局档案柜」，再从全局档案柜沉淀为冷档案' })
              return
            }
            const targetOpt = archiveTarget(runtime, rootSid || sessionId, { cabinetId, vaultScope })
            const out = await precipitateExperienceWithChief(makeChiefDeps(runtime), {
              sessionId: rootSid,
              vaultScope,
              op: typeof body.op === 'string' ? body.op : 'cabinet',
              cabinetId,
              folder: typeof body.folder === 'string' ? body.folder : '',
              ids: Array.isArray(body.ids) ? body.ids : [],
              clearSource: Boolean(body.clearSource),
            })
            const stNow = loadChiefState()
            const wsNow = rootSid && stNow.workspaces ? stNow.workspaces[rootSid] : null
            const flippedNow = (wsNow && Array.isArray(wsNow.flippedPrecipitatedIds)) ? wsNow.flippedPrecipitatedIds.slice() : []
            sendJson(res, out.ok ? 200 : 400, {
              ...out,
              counts: getThreeTierArchiveCounts(rootSid, flippedNow, targetOpt),
              archiveMeta: getArchiveMeta(rootSid, targetOpt),
            })
          } catch (error) {
            sendJson(res, 400, { ok: false, error: String(error && error.message ? error.message : error) })
          }
        },
      },
    ]
  }

  return {
    sendJson,
    readBody,
    resolveArchiveHttpScope,
    resolveBoundRootSid,
    collectDeskItemsForUi,
    routeTable,
  }
}
