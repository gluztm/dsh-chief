/**
 * chief-archives.js
 *
 * Archive organization, turn evidence harvesting, experience precipitation, and archive relay for DSH Chief.
 */

import path from 'node:path'
import {
  resolveProjectKey,
  loadArchiveStore,
  listArchiveHeaders,
  getArchiveDetail,
  smartParseNoteToDossier,
  mutateArchive,
  applyChiefArchiveCurations,
  getPrecipitatedDetail,
  savePrecipitatedEntry,
} from './archives.js'
import {
  CHAT_CAP,
  SUMMARY_MAX_TOKENS,
  archiveTargetForRoot,
  nextId,
  clamp,
  cleanMultiline,
  secretLike,
  loadChiefState,
  mutateChiefState,
  ensureWorkspace,
  stripCheckpointNoise,
  isInternalCheckpointNoise,
  extractJsonObject,
  beginChiefActiveWork,
  endChiefActiveWork,
  getChiefActiveWork,
} from './chief-state.js'
import { callChiefLlm } from './chief-models.js'
import { deliverCrossMessage } from './chief-network.js'
import { getChiefView } from './chief-view.js'

const ORGANIZE_ARCHIVES_SYSTEM = [
  '你是「DSH 参谋长」的工程档案馆馆长。请把杂乱的工程笔记按「档案柜文件夹抽屉 → 曲别针卷宗 → 分条记忆点 → 小点记忆」结构化整理收纳。',
  '',
  '【核心铁律】',
  '1. 默认标准抽屉 ID（优先归入这 5 个抽屉；仅当用户指令明确要求新建分类时才在 newFolders 中定义新抽屉）：',
  '   - "coords"    : 工程坐标与部署锚点（源码路径、端口、热更口令、验证脚本命令）',
  '   - "incidents" : 排障实录与硬事实（症状→根因→修复、踩坑实录、线上/本地故障）',
  '   - "contracts" : 架构契约与方法论（写入/截断/类型宽容契约、自检断言、设计规范）',
  '   - "ops"       : 运维链路与机器环境（本机环境硬事实、服务器/代理/容器链路、运维手册）',
  '   - "plans"     : 阶段蓝图与归档计划（能力对照表、历史阶段计划存档、交接里程碑）',
  '2. 曲别针等级 (`paperclip`)：',
  '   - "gold"   : 跨会话最核心必查锚点（如工程坐标、核心红线实录）',
  '   - "silver" : 标准已验证工程经验/契约/排障记录',
  '   - "copper" : 阶段性历史存档/旧计划备查',
  '3. 分条分块记忆点 (`points`) 与轻量钩子 (`hookKeywords` / `hookCue`)：',
  '   - 每份卷宗提炼 2～6 个结构清晰的「记忆点」，禁止把整篇堆成 1 大坨！',
  '   - 每个记忆点必须包含：',
  '     * `title` : 记忆点短标题（≤24字，点明这一条讲什么，如「症状表现」「根因与服务注入契约」「部署态验证命令」）',
  '     * `cue`   : 一句话速览钩子（≤48字，未展开时就能扫一眼看懂结论）',
  '     * `detail`: 点击展开的「小点记忆」（**必须无损保留**原文中的具体命令、文件路径、行号、参数名、错误码与核心判据，严禁编造原文没有的事实！）',
  '   - 同时为卷宗外表面提取轻量线索钩子：',
  '     * `hookKeywords`: 2～4 个精准短词/技术关键词（每个≤10字，如 `["热更端口", "MCP配置", "sqlite路径"]`）',
  '     * `hookCue`     : 一句话线索提示（≤32字，供折叠状态下扫一眼判断是否需要拉阅全文）',
  '4. **只输出一个合法 JSON 对象**，格式如下：',
  '{',
  '  "newFolders": [',
  '    { "id": "custom-key", "label": "新抽屉名称", "hint": "简短说明" }',
  '  ],',
  '  "items": [',
  '    {',
  '      "id": "原样回填输入的档案 id",',
  '      "folder": "coords|incidents|contracts|ops|plans 或自定义 id",',
  '      "paperclip": "gold|silver|copper",',
  '      "summary": "一句话卷宗总提要（≤52字）",',
  '      "hookKeywords": ["关键词1", "关键词2", "关键词3"],',
  '      "hookCue": "一句话线索钩子（≤32字）",',
  '      "tags": ["精炼标签1", "精炼标签2"],',
  '      "points": [',
  '        { "title": "记忆点标题", "cue": "速览钩子", "detail": "展开后的详细小点记忆（保留命令与路径）" }',
  '      ]',
  '    }',
  '  ]',
  '}',
].join('\n')

/**
 * Organize & structure engineering archives via DSH Chief LLM (`请参谋长整理收纳`).
 * Classifies dossiers into filing-cabinet folders, assigns gold/silver/copper paperclips,
 * extracts lightweight hooks (`hookKeywords`/`hookCue`), and breaks walls of text into crisp `points`.
 */
export async function organizeArchivesWithChief(deps, {
  sessionId = '',
  vaultScope = 'session',
  cabinetId = '',
  ids = [],
  folder = '',
  scope = 'unorganized',
  instruction = '',
  reasonKind = 'archive_organize',
  quiet = false,
} = {}) {
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || 'global')
  const effScope = vaultScope === 'global' ? 'global' : 'session'
  if (effScope === 'session' && (!rootId || rootId === 'global')) {
    return {
      ok: false,
      error: '当前为空白新对话，尚未建立本会话档案柜；如需整理全局知识请切至「🌐 全局档案柜」',
    }
  }
  const targetOpt = archiveTargetForRoot(deps, rootId, { cabinetId, vaultScope: effScope })
  const store = loadArchiveStore(targetOpt)

  if (!store.items.length) {
    return {
      ok: false,
      error: '当前「档案」柜中暂无可整理的工程卷宗，可先新建卷宗或将便签沉淀入柜。',
    }
  }

  const explicitIds = Array.isArray(ids) ? ids.map(x => String(x || '').trim()).filter(Boolean) : []
  let candidates = []
  if (explicitIds.length > 0) {
    const idSet = new Set(explicitIds)
    candidates = store.items.filter(it => idSet.has(it.id))
  } else if (folder) {
    candidates = store.items.filter(it => it.folder === folder)
  } else if (scope === 'all') {
    candidates = store.items.slice()
  } else {
    // Prefer unhooked / unorganized / inbox / single-point items first; if all were already organized, take newest batch
    const unorg = store.items.filter(it => !it.hasHook || it.folder === 'inbox' || it.organizedBy !== 'chief' || (it.points || []).length <= 1)
    candidates = unorg.length > 0 ? unorg : store.items.slice(0, 8)
  }

  if (!candidates.length) {
    return { ok: false, error: '未找到符合筛选范围的工程档案。' }
  }

  const BATCH_SIZE = 5
  const MAX_ITEMS_PER_RUN = explicitIds.length > 0 ? Math.min(explicitIds.length, 15) : 10
  const selected = candidates.slice(0, MAX_ITEMS_PER_RUN)
  const remainingCount = Math.max(0, candidates.length - selected.length)

  const isDream = reasonKind === 'dream_roam' || Boolean(quiet)
  const orgWorkId = getChiefActiveWork(rootId)
    ? ''
    : beginChiefActiveWork(
      rootId,
      isDream
        ? { tone: 'dream', tab: 'archive', label: '🌙 参谋长正在梦境漫游 · 轻拢卷宗与织就钩子中...' }
        : { tone: 'archive', tab: 'archive', label: '参谋长正在整理档案中...' },
    )
  try {
  const folderLines = store.folders.map(f => `- "${f.id}": ${f.label}（${f.hint || ''}）`)
  const allCurations = []
  const allNewFolders = []
  let usedLlm = false

  for (let offset = 0; offset < selected.length; offset += BATCH_SIZE) {
    const batch = selected.slice(offset, offset + BATCH_SIZE)
    const promptParts = [
      '现有档案柜文件夹抽屉：',
      ...folderLines,
      instruction ? `\n用户收纳叮嘱：${clamp(instruction, 240)}` : '',
      `\n待整理收纳的 ${batch.length} 份工程卷宗：`,
    ]
    batch.forEach((item, idx) => {
      promptParts.push(
        `\n--- 卷宗 #${idx + 1} ---`,
        `id: ${item.id}`,
        `标题: ${item.title}`,
        `当前抽屉: ${item.folder} | 当前曲别针: ${item.paperclip} | 原标签: ${(item.tags || []).join(', ') || '无'}`,
        `原始正文:\n${cleanMultiline(item.body || item.summary || item.title, 2600)}`,
      )
    })

    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      reasonKind,
      system: ORGANIZE_ARCHIVES_SYSTEM,
      prompt: promptParts.filter(Boolean).join('\n'),
      maxTokens: SUMMARY_MAX_TOKENS,
    })

    const parsed = llmRes.ok ? extractJsonObject(llmRes.text) : null
    if (parsed && Array.isArray(parsed.items) && parsed.items.length > 0) {
      usedLlm = true
      if (Array.isArray(parsed.newFolders)) {
        for (const nf of parsed.newFolders) allNewFolders.push(nf)
      }
      const byId = new Map(parsed.items.filter(x => x && x.id).map(x => [String(x.id).trim(), x]))
      for (const orig of batch) {
        const cur = byId.get(orig.id)
        if (cur) {
          allCurations.push(cur)
        } else {
          const fb = smartParseNoteToDossier(orig)
          allCurations.push({
            id: orig.id,
            folder: fb.folder,
            paperclip: fb.paperclip,
            summary: fb.summary,
            tags: orig.tags,
            points: fb.points,
            hookKeywords: Array.isArray(orig.tags) && orig.tags.length ? orig.tags.slice(0, 4) : [fb.folder],
            hookCue: clamp(fb.summary || orig.title, 48),
          })
        }
      }
    } else {
      // Deterministic high-precision fallback when LLM is offline or returned non-JSON
      for (const orig of batch) {
        const fb = smartParseNoteToDossier(orig)
        allCurations.push({
          id: orig.id,
          folder: orig.folder === 'inbox' ? fb.folder : (orig.folder || fb.folder),
          paperclip: fb.paperclip,
          summary: fb.summary,
          tags: orig.tags,
          points: fb.points,
          hookKeywords: Array.isArray(orig.tags) && orig.tags.length ? orig.tags.slice(0, 4) : [fb.folder],
          hookCue: clamp(fb.summary || orig.title, 48),
        })
      }
    }
  }

  const applied = applyChiefArchiveCurations(allCurations, allNewFolders, targetOpt)
  if (effScope === 'session' && selected.length > 0) {
    try {
      mutateArchive({ op: 'clearUnpinnedWatch', ids: selected.map(x => x.id), vaultScope: 'session' }, targetOpt)
    } catch {}
  }
  const refreshedList = listArchiveHeaders(rootId, { includePrecipitated: false }, targetOpt)
  const folderNameMap = new Map(refreshedList.folders.map(f => [f.id, f.label]))

  const folderStats = new Map()
  for (const c of allCurations) {
    const fName = folderNameMap.get(c.folder) || c.folder
    folderStats.set(fName, (folderStats.get(fName) || 0) + 1)
  }
  const statSummary = [...folderStats.entries()].map(([k, n]) => `「${k}」${n} 卷`).join('、')
  const reply = isDream
    ? `- 【🌙 梦境漫游归整完成】已轻拢 **${applied.updatedCount} 份**零散卷宗入抽屉（${statSummary}）并织就线索钩子。`
    : (`- 【档案收纳完成】已${usedLlm ? '由参谋长模型深度提炼' : '按结构规则分拣'} **${applied.updatedCount} 份**工程卷宗（归入 ${statSummary}），每份均已拆解「记忆点 → 小点记忆」并织就线索钩子，原文 100% 无损封存。`
      + (remainingCount > 0 ? `\n- 【分批提示】柜内另有 ${remainingCount} 份卷宗待精修，可再点一次「请参谋长整理收纳」继续完成剩余部分。` : ''))

  if (!quiet) {
    mutateChiefState((s) => {
      const ws = ensureWorkspace(s, rootId)
      ws.chat.push(
        {
          id: nextId('chat'),
          role: 'user',
          text: instruction ? `整理工程档案：${instruction}` : `请参谋长整理收纳工程档案（${applied.updatedCount} 卷）`,
          actions: [],
          at: Date.now(),
        },
        {
          id: nextId('chat'),
          role: 'chief',
          text: reply,
          actions: [`已收纳 ${applied.updatedCount} 卷档案`],
          at: Date.now(),
        },
      )
      if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
    })
  }

  if (typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(
      rootId,
      isDream
        ? `🌙 参谋长梦境漫游已梳理 ${applied.updatedCount} 卷档案（${statSummary}）并织就线索钩子`
        : `🗄️ 参谋长完成工程档案收纳：共精修 ${applied.updatedCount} 卷（${statSummary}）`,
      'chief',
    )
  }

  return {
    ok: true,
    updatedCount: applied.updatedCount,
    remainingCount,
    usedLlm,
    reply,
    archives: refreshedList,
    view: quiet ? null : await getChiefView(deps, rootId, { autoSummarize: false }),
  }
  } finally {
    if (orgWorkId) endChiefActiveWork(rootId, orgWorkId)
  }
}

const HARVEST_ARCHIVE_SYSTEM = [
  '你是「DSH 参谋长」的高精度上下文抢救员。当前即将执行上下文压缩或用户主动抢救本轮现场细节，请从原始对话与看板轨迹中无损抢救工程硬细节并归档！',
  '要求：',
  '1. 重点抓取：**具体文件路径、行号、真实命令/脚本参数、刚确认的报错根因与结论、尚未完成的断点、未解决的阻塞细节**，严禁泛泛而谈或丢弃关键参数。',
  '2. 绝对不要编造原文未出现的文件名或命令。',
  '3. 只输出一个合法 JSON 对象：',
  '{',
  '  "folder": "coords|incidents|contracts|ops|plans",',
  '  "paperclip": "gold|silver|copper",',
  '  "title": "精炼明确归档标题（≤38字）",',
  '  "summary": "一句话总结核心工程事实（≤56字）",',
  '  "tags": ["标签1", "标签2"],',
  '  "points": [',
  '    { "title": "记忆点短标题", "cue": "速览钩子", "detail": "含原文件路径/命令/结论的高保真明细" }',
  '  ]',
  '}',
].join('\n')

function collectRawSessionEvidence(deps, { sessionId = '', rootId = '', agent = null }) {
  const board = deps && deps.boardForSession && deps.boardFileFor
    ? deps.boardForSession(deps.boardFileFor(rootId))
    : null
  const lines = []
  if (board && board.objective) lines.push(`【当前总目标】${board.objective}`)
  if (board && board.cursor && (board.cursor.step || board.cursor.next || board.cursor.blocked)) {
    lines.push(`【断点游标】当前=${board.cursor.step || '无'} | 下一步=${board.cursor.next || '无'} | 阻塞=${board.cursor.blocked || '无'}`)
  }
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const openTasks = tasks.filter(t => t.status !== 'done').slice(0, 6)
  if (openTasks.length > 0) {
    lines.push('【进行中/未完任务】')
    for (const t of openTasks) {
      lines.push(`- [${t.status}] #${t.id} ${t.title}${t.note ? `（${clamp(t.note, 100)}）` : ''}`)
    }
  }

  let targetAgent = agent
  if (!targetAgent && deps && deps.runtime) {
    try {
      const agentsSvc = deps.runtime.get('agents')
      if (agentsSvc && typeof agentsSvc.get === 'function') {
        targetAgent = agentsSvc.get(sessionId) || agentsSvc.get(rootId)
      }
    } catch {}
  }

  const pathsFound = new Set()
  const cmdsFound = new Set()
  const rawTurns = []
  try {
    if (targetAgent && targetAgent.session && typeof targetAgent.session.deriveMessages === 'function') {
      const msgs = targetAgent.session.deriveMessages() || []
      for (const m of msgs.slice(-14)) {
        if (!m || !m.role) continue
        if (m.source && m.source.kind && m.source.kind !== 'user' && m.role === 'user') continue
        const blocks = Array.isArray(m.content)
          ? m.content
          : (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : [])
        for (const b of blocks) {
          if (!b || typeof b !== 'object') continue
          if (b.type === 'text' && typeof b.text === 'string') {
            const clean = stripCheckpointNoise(b.text)
            if (!clean || isInternalCheckpointNoise(clean) || secretLike(clean)) continue
            rawTurns.push(`${m.role === 'user' ? 'User' : 'Assistant'}: ${clamp(clean, 500)}`)
            const pathMatches = clean.match(/(?:[A-Za-z]:)?(?:[\\/][^\s'"`<>|]{2,70})+/g) || []
            for (const p of pathMatches.slice(0, 8)) pathsFound.add(p)
          } else if ((b.type === 'tool_use' || b.type === 'tool-call' || b.type === 'toolCall') && (b.name || b.toolName)) {
            const name = String(b.name || b.toolName)
            const rawArgs = b.input || b.arguments || b.args
            let obj = null
            try { obj = typeof rawArgs === 'string' ? JSON.parse(rawArgs) : rawArgs } catch {}
            const cmd = obj && (obj.command || obj.cmd || obj.CommandLine)
            const fpath = obj && (obj.path || obj.file_path || obj.Path)
            if (fpath && !secretLike(String(fpath))) pathsFound.add(String(fpath))
            if (cmd && !secretLike(String(cmd))) cmdsFound.add(clamp(String(cmd), 140))
            rawTurns.push(`Tool[${name}]: ${clamp(JSON.stringify(obj || {}), 220)}`)
          }
        }
      }
    }
  } catch {}

  if (pathsFound.size > 0) lines.push('', '【涉及路径与符号】\n' + [...pathsFound].slice(0, 12).map(p => `- ${p}`).join('\n'))
  if (cmdsFound.size > 0) lines.push('', '【近期执行命令】\n' + [...cmdsFound].slice(0, 8).map(c => `- \`${c}\``).join('\n'))
  if (rawTurns.length > 0) lines.push('', '【近期对话与工具流水】\n' + rawTurns.slice(-10).join('\n'))
  return {
    board,
    text: lines.join('\n').trim(),
    hasTranscript: rawTurns.length > 0,
    pathCount: pathsFound.size,
    cmdCount: cmdsFound.size,
  }
}

/** High-precision harvest of recent session details into active working archive cabinet (`pre-compaction` or `manual`). */
export async function harvestTurnDetailsToArchive(deps, {
  sessionId = '',
  agent = null,
  trigger = 'manual',
  focusHint = '',
  cabinetId = '',
  vaultScope = 'session',
} = {}) {
  const rootId = (deps && deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId, agent)) || String(sessionId || 'global')
  const effScope = vaultScope === 'global' ? 'global' : 'session'
  if (effScope === 'session' && (!rootId || rootId === 'global')) {
    return { ok: false, error: '当前为空白新对话（未绑定会话 ID），请先发送一条消息或切至「🌐 全局档案柜」再抢救归档' }
  }
  const targetOpt = archiveTargetForRoot(deps, rootId, { cabinetId, vaultScope: effScope })
  const harvWorkId = getChiefActiveWork(rootId)
    ? ''
    : beginChiefActiveWork(rootId, {
        tone: 'archive',
        tab: 'archive',
        label: trigger === 'pre-compaction' ? '参谋长正在压缩前抢救归档中...' : '参谋长正在抢救归档中...',
      })
  try {
  const evidence = collectRawSessionEvidence(deps, { sessionId: sessionId || rootId, rootId, agent })
  const bodySource = [
    focusHint ? `【抢救焦点提示】${cleanMultiline(focusHint, 240)}` : '',
    evidence.text || `【抢救快照】时间 ${new Date().toLocaleString('zh-CN')} | 触发原因：${trigger}`,
  ].filter(Boolean).join('\n\n')

  let parsed = null
  let usedLlm = false
  try {
    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      system: HARVEST_ARCHIVE_SYSTEM,
      prompt: `触发模式：${trigger === 'pre-compaction' ? '上下文压缩前自动高保真抢救' : '用户手动抢救当前工作细节入柜'}\n\n${cleanMultiline(bodySource, 5200)}`,
      maxTokens: SUMMARY_MAX_TOKENS,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      parsed = extractJsonObject(llmRes.text)
      if (parsed && (parsed.title || (Array.isArray(parsed.points) && parsed.points.length > 0))) {
        usedLlm = true
      }
    }
  } catch {}

  const fallback = smartParseNoteToDossier({
    title: `${trigger === 'pre-compaction' ? '【压缩前抢救】' : '【细节抢救】'}${clamp(focusHint || (evidence.board && evidence.board.objective) || '本轮工作现场细节', 28)}`,
    body: bodySource,
  })
  const d = new Date()
  const timeStamp = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  const title = clamp((parsed && parsed.title) || `${fallback.title || '工作细节抢救'} (${timeStamp})`, 70)
  const folder = String((parsed && parsed.folder) || fallback.folder || 'incidents').trim()
  const paperclip = ['gold', 'silver', 'copper'].includes(parsed && parsed.paperclip)
    ? parsed.paperclip
    : (trigger === 'pre-compaction' ? 'gold' : fallback.paperclip)
  const summary = clamp((parsed && parsed.summary) || fallback.summary || clamp(bodySource, 110), 180)
  const tags = Array.isArray(parsed && parsed.tags) && parsed.tags.length > 0
    ? parsed.tags.slice(0, 6)
    : [trigger === 'pre-compaction' ? '压缩抢救' : '细节抢救', ...(evidence.cmdCount > 0 ? ['命令流水'] : [])]
  const points = Array.isArray(parsed && parsed.points) && parsed.points.length > 0
    ? parsed.points
    : fallback.points

  const saveRes = mutateArchive({
    op: 'save',
    session: rootId,
    folder,
    paperclip,
    title,
    summary,
    tags,
    points,
    body: bodySource,
    organizedBy: 'chief',
  }, targetOpt)

  if (!saveRes || !saveRes.ok || !saveRes.item || !saveRes.item.id) {
    return { ok: false, error: (saveRes && saveRes.error) || '工作档案写入失败，未执行后续操作' }
  }

  // Strictly verify persistence on disk before returning ok!
  const verify = getArchiveDetail(saveRes.item.id, rootId, targetOpt)
  if (!verify || !verify.ok || !verify.item || verify.item.id !== saveRes.item.id) {
    return { ok: false, error: '档案硬盘落盘复核失败' }
  }

  if (deps && typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(rootId, `📥 已将本轮工程细节抢救入柜：《${title}》（trigger=${trigger}）`, 'chief')
  }

  return {
    ok: true,
    trigger,
    usedLlm,
    savedId: saveRes.item.id,
    item: verify.item,
    cabinetId: targetOpt.cabinetId || verify.cabinetId || '',
    archives: listArchiveHeaders(rootId, { includePrecipitated: trigger === 'manual' }, targetOpt),
  }
  } finally {
    if (harvWorkId) endChiefActiveWork(rootId, harvWorkId)
  }
}

const PRECIPITATE_EXPERIENCE_SYSTEM = [
  '你是「DSH 参谋长」的知识沉淀总编。请把当前工作档案柜（或指定抽屉）的多份工作卷宗脱水提炼为 1~3 条**跨会话长期可复用**的高密度经验胶囊，准备封存入 0-Token 冷库！',
  '原则：',
  '1. **去水保干**：彻底剔除单轮聊天客套话、过时中间试错步骤与一次性状态；只保留长期有价值的【工程架构契约 / 踩坑根因与解法 / 核心文件路径与校验命令】。',
  '2. 保留真实文件名、函数名、配置键、关键命令，绝不编造不存在的细节。',
  '3. 只输出一个合法 JSON 对象：',
  '{',
  '  "entries": [',
  '    {',
  '      "title": "沉淀经验短标题（≤36字）",',
  '      "category": "coords|incidents|contracts|ops",',
  '      "summary": "一句话价值摘要（≤60字）",',
  '      "tags": ["标签1", "标签2"],',
  '      "points": [',
  '        { "title": "要点标题", "cue": "一句话钩子", "detail": "完整可复用步骤/路径/契约" }',
  '      ],',
  '      "body": "完整精炼正文"',
  '    }',
  '  ]',
  '}',
].join('\n')

/** Purify working archive items into reusable long-term entries saved to `precipitated/vault-global.json`. */
export async function precipitateExperienceWithChief(deps, {
  sessionId = '',
  vaultScope = 'global',
  op = 'cabinet',
  cabinetId = '',
  folder = '',
  ids = [],
  clearSource = false,
} = {}) {
  if (vaultScope !== 'global') {
    return {
      ok: false,
      error: '实行三层档案梯度制度：本会话档案不可直接沉淀入冷库！请先点击「🌐 升级入全局」进入全局档案柜，再从全局档案柜沉淀可复用冷经验。',
    }
  }
  const rootId = (deps && deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || 'global')
  const effScope = 'global'
  const targetOpt = archiveTargetForRoot(deps, rootId, { cabinetId, vaultScope: effScope })
  const store = loadArchiveStore(targetOpt)
  const projectKey = resolveProjectKey(targetOpt.cwd)

  const idSet = Array.isArray(ids) && ids.length > 0
    ? new Set(ids.map(x => String(x || '').trim()).filter(Boolean))
    : null
  const selectedItems = idSet
    ? store.items.filter(it => idSet.has(String(it.id)))
    : ((op === 'drawer' && folder) ? store.items.filter(it => it.folder === folder) : store.items.slice())

  if (!selectedItems.length) {
    return { ok: false, error: '当前选定范围暂无工作档案可沉淀' }
  }

  const precWorkId = getChiefActiveWork(rootId)
    ? ''
    : beginChiefActiveWork(rootId, { tone: 'archive', tab: 'archive', label: '参谋长正在沉淀经验入库中...' })
  try {
  const promptBody = selectedItems.slice(0, 12).map((it, idx) => [
    `--- 工作档案 #${idx + 1}: 《${it.title}》 (drawer=${it.folder}, clip=${it.paperclip}) ---`,
    `提要: ${it.summary || '无'}`,
    Array.isArray(it.points) && it.points.length > 0
      ? '记忆点:\n' + it.points.map(p => `- ${p.title}: ${p.detail || p.cue}`).join('\n')
      : `正文:\n${cleanMultiline(it.body, 1500)}`,
  ].join('\n')).join('\n\n')

  let entriesRaw = null
  let usedLlm = false
  try {
    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      reasonKind: 'precipitate',
      system: PRECIPITATE_EXPERIENCE_SYSTEM,
      prompt: `待沉淀工程档案范围：${op === 'drawer' && folder ? `抽屉 ${folder}` : '整柜'}（共 ${selectedItems.length} 卷）\n\n${cleanMultiline(promptBody, 6400)}`,
      maxTokens: SUMMARY_MAX_TOKENS,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      const parsed = extractJsonObject(llmRes.text)
      if (parsed && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
        entriesRaw = parsed.entries.slice(0, 4)
        usedLlm = true
      }
    }
  } catch {}

  if (!entriesRaw) {
    // Deterministic distillation fallback preserving high-signal points & paths
    const leadTitle = op === 'drawer' && folder
      ? `【${folder} 沉淀】${selectedItems[0].title}`
      : `【工程沉淀】${selectedItems[0].title}${selectedItems.length > 1 ? ` 等 ${selectedItems.length} 卷精华` : ''}`
    const mergedPoints = []
    const mergedTags = new Set(['已沉淀'])
    const bodyBlocks = []
    for (const it of selectedItems.slice(0, 8)) {
      for (const tg of (it.tags || [])) mergedTags.add(tg)
      bodyBlocks.push(`### ${it.title}\n${cleanMultiline(it.summary || it.body, 500)}`)
      if (Array.isArray(it.points) && it.points.length > 0) {
        for (const pt of it.points.slice(0, 3)) {
          mergedPoints.push(pt)
        }
      } else {
        mergedPoints.push({
          title: clamp(it.title, 32),
          cue: clamp(it.summary || it.body, 56),
          detail: cleanMultiline(it.body || it.summary, 420),
        })
      }
    }
    entriesRaw = [{
      title: clamp(leadTitle, 64),
      category: folder || selectedItems[0].folder || 'contracts',
      summary: clamp(selectedItems.map(x => x.summary || x.title).filter(Boolean).slice(0, 2).join('；'), 140),
      tags: [...mergedTags].slice(0, 6),
      points: mergedPoints.slice(0, 10),
      body: bodyBlocks.join('\n\n'),
    }]
  }

  const savedEntries = []
  for (const raw of entriesRaw) {
    const res = savePrecipitatedEntry(projectKey, {
      ...raw,
      sourceCabinet: store.cabinetName || store.cabinetId,
      sourceCount: selectedItems.length,
    }, targetOpt)
    if (res && res.ok && res.entry) savedEntries.push(res.entry)
  }

  if (!savedEntries.length) {
    return { ok: false, error: '沉淀写入冷库失败，已保留原有工作档案' }
  }

  let clearedSource = false
  if (clearSource) {
    if (!idSet && op === 'drawer' && folder) {
      mutateArchive({ op: 'clearFolder', folder }, targetOpt)
      clearedSource = true
    } else {
      mutateArchive({ op: 'clearByIds', ids: selectedItems.map(x => x.id) }, targetOpt)
      clearedSource = true
    }
  }

  if (deps && typeof deps.appendBoardLog === 'function' && rootId !== 'global') {
    deps.appendBoardLog(rootId, `⏬ 已从${selectedItems.length} 卷工作档案提炼 ${savedEntries.length} 条可复用经验封存入 0-Token 冷库`, 'chief')
  }

  return {
    ok: true,
    projectKey,
    usedLlm,
    createdCount: savedEntries.length,
    entries: savedEntries,
    clearedSource,
    archives: listArchiveHeaders(rootId, { includePrecipitated: true }, targetOpt),
  }
  } finally {
    if (precWorkId) endChiefActiveWork(rootId, precWorkId)
  }
}

const DISTILL_TO_GLOBAL_SYSTEM = [
  '你是「DSH 参谋长」的知识萃取总编。请审查当前「本会话工作档案柜」中的临时工作卷宗：',
  '1. **摘除一次性噪音**：剔除只属于本次调试流水账、临时状态快照或纯闲聊过渡的信息；',
  '2. **萃取可复用精华**：只摘出并总结未来跨会话仍长期有用的【工程坐标、入口路径、架构契约、核心命令、接口定义、通用踩坑与红线经验】；',
  '3. **浓缩成全局卷宗**：同类主题合并为 1~4 卷高信息密度、结构清晰的全局档案，保留真实文件名/函数名/命令参数，严禁编造；',
  '4. **只输出一个合法 JSON 对象**：',
  '{',
  '  "entries": [',
  '    {',
  '      "title": "全局档案短标题（≤36字）",',
  '      "folder": "coords|incidents|contracts|ops",',
  '      "paperclip": "gold|silver",',
  '      "summary": "一句话可复用价值摘要（≤60字）",',
  '      "tags": ["标签1", "标签2"],',
  '      "points": [',
  '        { "title": "要点标题", "cue": "一句话钩子", "detail": "完整可复用步骤/路径/契约" }',
  '      ],',
  '      "body": "完整精炼正文"',
  '    }',
  '  ]',
  '}',
].join('\n')

/** Extract, summarize, and distill reusable items from the current Session Cabinet into the Global Vault (`vaultScope: 'global'`). */
export async function distillSessionArchivesToGlobal(deps, {
  sessionId = '',
  cabinetId = '',
  ids = null,
  folder = '',
  clearSource = false,
  instruction = '',
} = {}) {
  const rootId = (deps && deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || '').trim()
  if (!rootId || rootId === 'global') {
    return { ok: false, error: '当前未绑定具体对话会话，无法从本局档案柜提炼入全局库' }
  }

  const sessionOpt = archiveTargetForRoot(deps, rootId, { cabinetId, vaultScope: 'session' })
  const globalOpt = archiveTargetForRoot(deps, rootId, { vaultScope: 'global' })
  const store = loadArchiveStore(sessionOpt)

  const idSet = Array.isArray(ids) && ids.length > 0
    ? new Set(ids.map(x => String(x || '').trim()).filter(Boolean))
    : null
  const folderClean = typeof folder === 'string' ? folder.trim() : ''
  let selected = idSet
    ? store.items.filter(it => idSet.has(String(it.id)))
    : (folderClean ? store.items.filter(it => it.folder === folderClean) : store.items.slice())

  if (!selected.length) {
    return { ok: false, error: '当前本会话档案柜暂无可供提炼的档案条目' }
  }

  const distWorkId = getChiefActiveWork(rootId)
    ? ''
    : beginChiefActiveWork(rootId, { tone: 'archive', tab: 'archive', label: '参谋长正在提炼全局档案中...' })
  try {
  // Prioritize reusable engineering anchors/clips first
  const clipRank = { gold: 0, silver: 1, copper: 2 }
  selected = [...selected].sort((a, b) => (clipRank[a.paperclip] ?? 1) - (clipRank[b.paperclip] ?? 1))

  const promptBody = selected.slice(0, 14).map((it, idx) => [
    `--- 本局档案 #${idx + 1}: 《${it.title}》 (folder=${it.folder}, clip=${it.paperclip}) ---`,
    `提要: ${it.summary || '无'}`,
    Array.isArray(it.points) && it.points.length > 0
      ? '记忆点:\n' + it.points.map(p => `- ${p.title}: ${p.detail || p.cue}`).join('\n')
      : `正文:\n${cleanMultiline(it.body, 1400)}`,
  ].join('\n')).join('\n\n')

  let entriesRaw = null
  let usedLlm = false
  try {
    const llmRes = await callChiefLlm(deps, {
      sessionId: rootId,
      reasonKind: 'distill',
      system: DISTILL_TO_GLOBAL_SYSTEM,
      prompt: [
        instruction ? `用户指定提炼侧重：${clamp(instruction, 240)}\n` : '',
        `待萃取本局工作档案（共 ${selected.length} 卷）：`,
        cleanMultiline(promptBody, 6800),
      ].filter(Boolean).join('\n'),
      maxTokens: SUMMARY_MAX_TOKENS,
    })
    if (llmRes && llmRes.ok && llmRes.text) {
      const parsed = extractJsonObject(llmRes.text)
      if (parsed && Array.isArray(parsed.entries) && parsed.entries.length > 0) {
        entriesRaw = parsed.entries.slice(0, 4)
        usedLlm = true
      }
    }
  } catch {}

  if (!entriesRaw) {
    // Deterministic fallback: distill gold/silver/reusable items grouped cleanly into global vault entries
    const reusable = selected.filter(it => it.paperclip !== 'copper')
    const pool = reusable.length ? reusable : selected
    const lead = pool[0]
    const mergedPoints = []
    const bodyBlocks = []
    const mergedTags = new Set(['全局萃取', ...(instruction ? ['专项提炼'] : [])])
    for (const it of pool.slice(0, 8)) {
      for (const tg of (it.tags || [])) mergedTags.add(tg)
      bodyBlocks.push(`### 《${it.title}》\n${cleanMultiline(it.summary || it.body, 480)}`)
      if (Array.isArray(it.points) && it.points.length > 0) {
        for (const pt of it.points.slice(0, 3)) mergedPoints.push(pt)
      } else {
        mergedPoints.push({
          title: clamp(it.title, 32),
          cue: clamp(it.summary || it.body, 56),
          detail: cleanMultiline(it.body || it.summary, 420),
        })
      }
    }
    const validFolders = new Set(['coords', 'incidents', 'contracts', 'ops', 'inbox'])
    entriesRaw = [{
      title: clamp(`【全局萃取】${lead.title}${pool.length > 1 ? ` 等 ${pool.length} 卷精选` : ''}`, 56),
      folder: validFolders.has(lead.folder) ? lead.folder : 'contracts',
      paperclip: lead.paperclip === 'gold' ? 'gold' : 'silver',
      summary: clamp(pool.map(x => x.summary || x.title).filter(Boolean).slice(0, 2).join('；'), 140),
      tags: [...mergedTags].slice(0, 6),
      points: mergedPoints.slice(0, 10),
      body: bodyBlocks.join('\n\n'),
    }]
  }

  const savedEntries = []
  const validFolders = new Set(['coords', 'incidents', 'contracts', 'ops', 'inbox'])
  for (const raw of entriesRaw) {
    if (!raw || typeof raw !== 'object') continue
    const title = clamp(raw.title || '全局萃取卷宗', 64)
    const f = validFolders.has(raw.folder) ? raw.folder : 'contracts'
    const clip = raw.paperclip === 'gold' ? 'gold' : 'silver'
    const res = mutateArchive({
      op: 'save',
      vaultScope: 'global',
      folder: f,
      paperclip: clip,
      title,
      summary: clamp(raw.summary || '', 160),
      tags: Array.isArray(raw.tags) ? raw.tags.slice(0, 8) : ['全局萃取'],
      points: Array.isArray(raw.points) ? raw.points : [],
      body: cleanMultiline(raw.body || raw.summary || title, 4000),
      by: 'DSH 参谋长萃取',
      organizedBy: 'chief',
      rootSessionId: rootId,
    }, globalOpt)
    if (res && res.ok && res.item) savedEntries.push(res.item)
  }

  if (!savedEntries.length) {
    return { ok: false, error: '全局档案柜写入失败，已保留原有本局工作档案' }
  }

  let clearedSource = false
  if (clearSource) {
    if (!idSet && folderClean) {
      mutateArchive({ op: 'clearFolder', folder: folderClean, vaultScope: 'session' }, sessionOpt)
      clearedSource = true
    } else {
      mutateArchive({ op: 'clearByIds', ids: selected.map(x => x.id), vaultScope: 'session' }, sessionOpt)
      clearedSource = true
    }
  }

  const summaryReply = `- 【✦ 本局萃取入全局】已从本会话 ${selected.length} 卷工作档案中摘除临时噪音并提炼 **${savedEntries.length} 卷**可复用精华存入「🌐 全局档案柜」${clearedSource ? '（已按勾选清理本局原卷宗）' : '（本局原卷宗无损保留）'}：${savedEntries.map(e => `《${e.title}》`).join('、')}。`
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.chat.push({
      id: nextId('chat'),
      role: 'chief',
      text: summaryReply,
      actions: [`萃取入全局 ×${savedEntries.length}`],
      at: Date.now(),
    })
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })
  if (deps && typeof deps.appendBoardLog === 'function') {
    deps.appendBoardLog(rootId, `✦ 参谋长已从本局 ${selected.length} 卷档案摘出可复用精华，保存 ${savedEntries.length} 卷入全局档案柜`, 'chief')
  }

  const stNow = loadChiefState()
  const wsNow = stNow.workspaces ? stNow.workspaces[rootId] : null
  const flippedIds = wsNow && Array.isArray(wsNow.flippedPrecipitatedIds) ? wsNow.flippedPrecipitatedIds : []
  return {
    ok: true,
    usedLlm,
    createdCount: savedEntries.length,
    entries: savedEntries,
    clearedSource,
    reply: summaryReply,
    archives: listArchiveHeaders(rootId, { vaultScope: 'session', includePrecipitated: true, flippedIds }, sessionOpt),
    globalArchives: listArchiveHeaders(rootId, { vaultScope: 'global', includePrecipitated: true, flippedIds }, globalOpt),
    view: await getChiefView(deps, rootId, { autoSummarize: false }),
  }
  } finally {
    if (distWorkId) endChiefActiveWork(rootId, distWorkId)
  }
}

export function buildChiefArchiveUpsertFn(deps, rootId) {
  return async (arc) => {
    const sc = arc && arc.vaultScope === 'global' ? 'global' : 'session'
    const opt = archiveTargetForRoot(deps, rootId, { vaultScope: sc })
    return mutateArchive({
      op: 'save',
      session: rootId,
      folder: (arc && arc.folder) || 'inbox',
      paperclip: 'silver',
      title: (arc && arc.title) || '参谋长工作归档',
      summary: (arc && arc.summary) || '',
      body: (arc && arc.body) || '',
      tags: Array.isArray(arc && arc.tags) ? arc.tags : [],
      by: 'chief',
      organizedBy: 'chief',
    }, opt)
  }
}

/**
 * Multi-Archive Combinatorial Relay (`递话`):
 * Bundles 1+ archives across Session / Global / Precipitated vaults together with the user's explicit instruction
 * and delivers them cleanly to `@lead` or the specified target agent.
 */
export async function relayArchivesWithChief(deps, { sessionId, items = [], instruction = '', target = 'lead', mode = 'steer', cabinetId = '' } = {}) {
  const rawSid = String(sessionId || '').trim()
  const rootId = (deps.resolveRootSessionId && deps.resolveRootSessionId(rawSid)) || rawSid || 'global'
  const selected = Array.isArray(items) ? items.slice(0, 8) : []
  const reqText = cleanMultiline(instruction, 800)
  if (!selected.length && !reqText) {
    return { ok: false, error: '请先勾选至少 1 份档案或输入带话要求' }
  }

  const baseOpt = archiveTargetForRoot(deps, rootId, { cabinetId, vaultScope: 'session' })
  const projectKey = resolveProjectKey(baseOpt.cwd)
  const loaded = []
  const scopeLabelMap = { session: '本局档案', global: '全局档案', precipitated: '沉淀冷库' }

  for (const ref of selected) {
    if (!ref || !ref.id) continue
    const rawSc = ref.scope || ref.vaultScope
    const sc = ['session', 'global', 'precipitated'].includes(rawSc) ? rawSc : 'session'
    let entry = null
    if (sc === 'precipitated') {
      const pRes = getPrecipitatedDetail(projectKey, ref.id, rootId, baseOpt)
      if (pRes && pRes.ok && pRes.item) entry = pRes.item
    } else {
      const opt = archiveTargetForRoot(deps, rootId, { cabinetId: sc === 'session' ? cabinetId : '', vaultScope: sc })
      const aRes = getArchiveDetail(ref.id, rootId, opt)
      if (aRes && aRes.ok && aRes.item) entry = aRes.item
    }
    if (entry) {
      loaded.push({ scope: sc, scopeLabel: scopeLabelMap[sc], item: entry })
    } else if (ref.title) {
      loaded.push({ scope: sc, scopeLabel: scopeLabelMap[sc], item: { id: ref.id, title: ref.title, summary: ref.summary || '', body: '', points: [] } })
    }
  }

  if (!loaded.length && selected.length) {
    return { ok: false, error: '未能读取所选档案内容，请刷新档案列表后重试' }
  }

  const header = `📎 【参谋长代用户带要求递交工程档案（共 ${loaded.length} 份）】`
  const reqBlock = reqText
    ? `📝 【用户本次明确要求】：\n${reqText}`
    : '📝 【用户要求】：请重点结合以下档案内容对照推进当前任务。'
  const docBlocks = loaded.map((d, idx) => {
    const it = d.item
    const pts = Array.isArray(it.points) && it.points.length
      ? it.points.slice(0, 5).map(p => `  - ${p.title}：${clamp(p.detail || p.cue, 160)}`).join('\n')
      : ''
    const rawSnippet = cleanMultiline(it.rawBody || it.body || it.summary || '', 360)
    return [
      `### ${idx + 1}. [${d.scopeLabel}] 《${clamp(it.title || '未命名档案', 56)}》`,
      it.summary ? `> 摘要：${clamp(it.summary, 140)}` : '',
      pts || '',
      rawSnippet && !pts ? rawSnippet : '',
    ].filter(Boolean).join('\n')
  })

  const fullText = [header, reqBlock, '', ...docBlocks].join('\n\n')
  const safeMode = ['steer', 'followup', 'silent'].includes(mode) ? mode : 'steer'
  const delivery = await deliverCrossMessage(deps, {
    fromSession: rootId,
    fromLabel: '用户（经 DSH 参谋长递送档案）',
    target: target || 'lead',
    subject: loaded.length === 1 ? `递交档案《${clamp(loaded[0].item.title, 28)}》` : `合并递交 ${loaded.length} 份档案`,
    text: fullText,
    mode: safeMode,
  })

  const titlesStr = loaded.map(d => `《${clamp(d.item.title, 24)}》`).join('、')
  mutateChiefState((s) => {
    const ws = ensureWorkspace(s, rootId)
    ws.chat.push(
      {
        id: nextId('chat'),
        role: 'user',
        text: `📎 递送档案 ${titlesStr || '（无）'}${reqText ? `\n要求：${reqText}` : ''}`,
        actions: [],
        at: Date.now(),
      },
      {
        id: nextId('chat'),
        role: 'chief',
        text: delivery.ok
          ? `- 【已按要求合并递话】已将 ${titlesStr} 连同你的要求（${safeMode === 'steer' ? '立即插话' : safeMode === 'silent' ? '静默纸条' : '排入续行'}）传达给 ${delivery.target || target || '@lead'}。`
          : `- 【递话失败】${delivery.error || '目标不可达'}`,
        actions: delivery.ok ? [`→ ${delivery.target || target || 'lead'} (${loaded.length}卷)`] : ['递话失败'],
        at: Date.now(),
      },
    )
    if (ws.chat.length > CHAT_CAP) ws.chat = ws.chat.slice(-CHAT_CAP)
  })

  return {
    ok: Boolean(delivery && delivery.ok),
    error: delivery && !delivery.ok ? delivery.error : '',
    delivery,
    count: loaded.length,
    view: await getChiefView(deps, rootId, { autoSummarize: false }),
  }
}

/**
 * Managed-mode background「🌙 梦境漫游」:
 * Gently sweeps unhooked drafts & recently unpinned desktop watch entries in session/global vaults,
 * sorts them into filing-cabinet drawers, and weaves lightweight keyword hooks (`hasHook=true`).
 * Strictly forbidden from writing workspace code, pinning items back to Desktop, or pushing to Lead.
 */
export async function runManagedDreamRoam(deps, { sessionId = '', maxPerVault = 6 } = {}) {
  const rootId = (deps && deps.resolveRootSessionId && deps.resolveRootSessionId(sessionId)) || String(sessionId || 'global')
  let sessionProcessed = 0
  let globalProcessed = 0
  const cap = Math.max(1, Math.min(12, Number(maxPerVault) || 6))

  const hasOwnSession = Boolean(rootId && rootId !== 'global')
  const sessOpt = hasOwnSession ? archiveTargetForRoot(deps, rootId, { vaultScope: 'session' }) : null
  const globOpt = archiveTargetForRoot(deps, rootId, { vaultScope: 'global' })

  const todoSessIds = []
  const alreadyHookedWatchIds = []
  if (sessOpt) {
    try {
      const sStore = loadArchiveStore(sessOpt)
      const watchSet = new Set((sStore.recentlyUnpinnedWatch || []).map(w => w.id))
      for (const it of (sStore.items || [])) {
        const needsWork = !it.hasHook || it.folder === 'inbox' || it.organizedBy !== 'chief' || (it.points || []).length <= 1
        if (needsWork || watchSet.has(it.id)) {
          if (needsWork) todoSessIds.push(it.id)
          else if (watchSet.has(it.id)) alreadyHookedWatchIds.push(it.id)
        }
      }
    } catch {}
  }

  const todoGlobIds = []
  try {
    const gStore = loadArchiveStore(globOpt)
    for (const it of (gStore.items || [])) {
      if (!it.hasHook || it.folder === 'inbox' || it.organizedBy !== 'chief' || (it.points || []).length <= 1) {
        todoGlobIds.push(it.id)
      }
    }
  } catch {}

  if (!todoSessIds.length && !todoGlobIds.length && !alreadyHookedWatchIds.length) {
    return { ok: true, roamed: 0, sessionProcessed: 0, globalProcessed: 0 }
  }

  const dreamWorkId = getChiefActiveWork(rootId)
    ? ''
    : beginChiefActiveWork(rootId, { tone: 'dream', tab: 'archive', label: '🌙 参谋长正在梦境漫游 · 轻拢卷宗与织就钩子中...' })

  try {
    if (alreadyHookedWatchIds.length && sessOpt) {
      try {
        mutateArchive({ op: 'clearUnpinnedWatch', ids: alreadyHookedWatchIds, vaultScope: 'session' }, sessOpt)
      } catch {}
    }
    if (todoSessIds.length && hasOwnSession) {
      const res = await organizeArchivesWithChief(deps, {
        sessionId: rootId,
        vaultScope: 'session',
        ids: todoSessIds.slice(0, cap),
        reasonKind: 'dream_roam',
        quiet: true,
        instruction: '🌙 梦境漫游归整：请仅对尚未分类/未织钩子或刚撤下桌面的本局卷宗进行分拣入屉并提炼 hookKeywords/hookCue，严禁擅自改代码或回推桌面。',
      }).catch(() => null)
      if (res && res.ok) sessionProcessed = Number(res.updatedCount) || 0
    }
    if (todoGlobIds.length) {
      const res = await organizeArchivesWithChief(deps, {
        sessionId: rootId,
        vaultScope: 'global',
        ids: todoGlobIds.slice(0, cap),
        reasonKind: 'dream_roam',
        quiet: true,
        instruction: '🌙 梦境漫游归整：请为新入全局柜的零散草稿轻拢分类并织就轻量钩子，供后续全局索引备查。',
      }).catch(() => null)
      if (res && res.ok) globalProcessed = Number(res.updatedCount) || 0
    }
    return {
      ok: true,
      roamed: sessionProcessed + globalProcessed,
      sessionProcessed,
      globalProcessed,
    }
  } finally {
    if (dreamWorkId) endChiefActiveWork(rootId, dreamWorkId)
  }
}
