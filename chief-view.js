/**
 * chief-view.js
 *
 * Situation awareness view, narrative synthesis, and concise fallback reports for DSH Chief.
 */

import crypto from 'node:crypto'
import { stripToolCallMarkup, listGuardWalls } from './chief-executor.js'
import {
  AUTO_SUMMARY_COOLDOWN_MS,
  CHAT_OPPORTUNISTIC_SUMMARY_COOLDOWN_MS,
  SUMMARY_MAX_TOKENS,
  collectChiefVisibleArchives,
  resolveSessionWorkspaceCwd,
  clamp,
  resolveWorkspaceConfig,
  loadChiefState,
  mutateChiefState,
  computeClusterSig,
  ensureWorkspace,
  clusterView,
  shortAgentBriefName,
  stripCheckpointNoise,
  isInternalCheckpointNoise,
  beginChiefActiveWork,
  endChiefActiveWork,
  getChiefActiveWork,
  summarizeLlmLedger,
} from './chief-state.js'
import { listChiefModels, callChiefLlm } from './chief-models.js'
import { collectClusterPeerProgress, listPeerDirectory, computeBubbleState } from './chief-network.js'

let idleAutoPilotHook = null

export function registerIdleAutoPilotHook(fn) {
  idleAutoPilotHook = typeof fn === 'function' ? fn : null
}

const SUMMARY_FORMAT_REV = 'v5-six-goal-lines'

const NARRATIVE_SYSTEM = [
  '你是「DSH 参谋长」（如同统揽全局的宰相），负责把当前工作区和协同团队的目标、进展、纪律与红线边界，提炼成用户一眼扫完就能掌握全局的「摘要」。',
  '严格遵守以下【简明结构化 · 分点作答】规范：',
  '1. 使用简体中文，语气精炼干脆、直击要害，严禁寒暄套话与冗长铺垫。',
  '2. 全文分为 2 到 4 个模块，每个模块以一行 `## 模块短标题` 开头（如 `## 核心目标与态势`、`## 关键结论与进展`、`## 协作纪律与红线`、`## 协作纪律与边界`）。',
  '3. **每个模块下方必须全部使用 `- ` 分点列表作答（严禁写成挤在一起的长段落散文！）**。每一点控制在 1 行（最多不超过 2 行），推荐在要点开头用方括号短标签提亮，如 `- 【总目标】…`、`- 【推进中】…`、`- 【已完】…`、`- 【已验证】…`、`- 【结论】…`、`- 【待办】…`、`- 【待收尾】…`、`- 【注意】…`、`- 【归因纪律】…`、`- 【收尾纪律】…`、`- 【并列直接原因】…`、`- 【受阻】…`、`- 【禁止红线】…`、`- 【必做事项】…`。',
  '4. **去噪与聚合铁律**：遇到大量同前缀或已结束的后台巡检子代理（如 `mnemon-review-*`），**严禁逐一报菜名罗列**，必须合并成一句话统计；自动忽略 `[dsh-mnemon:...]` 等系统内部检查点噪音。',
  '5. 具体路径、端口、版本号、命令原样保留，同一事实绝不重复，只陈述真实输入，第一个 `## ` 之前不要输出任何多余字符。',
].join('\n')

const CONCISE_BRIEF_NARRATIVE_EXTRA = [
  '',
  '⚡ 【当前已开启极简战报模式 — 六句话目标边界系列（最高优先级覆盖一切细节规则！）】：',
  '- **一切以目标为导向，说人话，拒绝任何事务细节**：严禁出现任何文件路径、文件名、代码符号/函数名、行号、端口号、Token/字节数、耗时、版本号、终端命令或具体计数统计！',
  '- **严格只输出如下 1 个标题 + 刚好 6 行单句列表（不要多也不要少）**：',
  '  ## 极简目标战报',
  '  - 【🎯 总目标】用一句人话说清最终要达成的目标。',
  '  - 【🚀 当前推进目标】用一句人话说清现在正聚焦推进的阶段目标。',
  '  - 【⛔ 受阻目标】若无受阻写“当前暂无受阻目标”；若有受阻，用一句人话点明卡住的目标与原因。',
  '  - 【🧰 需要什么】用一句人话说明达成目标还缺的前提、验证或支撑条件（无则写“条件已齐备，可顺畅推进”）。',
  '  - 【🙋 用户需要提供什么】若需要您拍板、授权、提供账号/素材或重启确认写一句人话；无需操作写“暂无需您额外提供，可继续推进”。',
  '  - 【💡 参谋长建议】用一句人话给出最清晰可执行的建议或建议弹窗拍板方向。',
  '- 每条控制在 1 句精炼大白话（20~55 字），切忌写成事务流水账或代码改动清单！',
].join('\n')

/** Remove or qualitatively normalize raw numeric parameters, file paths & technical trivia when Concise Brief Mode (`极简战报模式`) is enabled. */
export function sanitizeConciseBriefText(text) {
  const src = String(text || '')
  if (!src.trim()) return ''
  return src
    .replace(/[A-Za-z]:\\[^\s"'`）)】]+/g, '本地相关目录')
    .replace(/(?:^|\s)\/(?:[\w.-]+\/)+[\w.-]*/g, ' 相关路径')
    .replace(/\b[\w.-]+\.(?:m?[jt]sx?|py|json|ya?ml|md|css|html|sh|ps1)\b/gi, '相关模块')
    .replace(/`[^`]{2,64}`/g, '对应能力')
    .replace(/\bv?\d+\.\d+\.\d+(?:-[a-z0-9.]+)?\b/gi, '当前版本')
    .replace(/\bL\d+(?:\s*[-~–]\s*L?\d+)?\b/g, '相关位置')
    .replace(/:\d{2,5}\b/g, '')
    .replace(/(?:端口|port)\s*\d{2,5}/gi, '对应端口')
    .replace(/(?:第)\s*\d+(?:\.\d+)?\s*(?:行|页|步|轮|阶段)/gi, '当前阶段')
    .replace(/(?:耗时|用时|约|共|已有|剩余|累计|包含|存在|触发|达到|占比)\s*\d+(?:\.\d+)?\s*(?:ms|s|毫秒|秒|分钟|小时|天|字节|bytes?|KB|MB|GB|K|M|%|％|项|个|条|卷|次|步|轮|行|页|张|名|家|处)/gi, (m) => {
      if (/(?:%|％)/.test(m)) return '相应比例'
      if (/(?:ms|s|毫秒|秒|分钟|小时)/.test(m)) return '短暂耗时'
      if (/(?:KB|MB|GB|K|M|字节|bytes?)/i.test(m)) return '一定体量'
      return '若干进展'
    })
    .replace(/\b\d+(?:\.\d+)?\s*(?:%|％)/g, '相应比例')
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|毫秒|KB|MB|GB)(?![a-z0-9_])/gi, '相应规模')
    .replace(/(^|\s)#\d+\b/g, '$1该目标')
    .replace(/\b\d{3,}\b/g, '若干')
    .replace(/(?<=[\u4e00-\u9fa5\s])\d+(?=[\s]*(?:项|个|条|卷|次|步|轮|名|处|份|行))/g, '若干')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Synthesize the 6-line goal-only human report (`六句话目标边界系列`) shared by Narrative fallback & AskChief fallback. */
export function buildConciseSixLineReport({ board, blocked = [], doing = [], todo = [], done = [], workers = [], suggestions = [], needFromUserHint = '' }) {
  const clean = (s, max = 54) => sanitizeConciseBriefText(clamp(String(s || '').replace(/\s+/g, ' ').trim(), max))
  const planSteps = Array.isArray(board && board.plan) ? board.plan.filter(Boolean) : []
  const openPlan = planSteps.filter(s => !s.done)
  const donePlan = planSteps.filter(s => s.done)
  const objText = (board && board.objective) ? clean(board.objective, 56) : '按您当前的指令完成本阶段目标'
  let curText = '等待您确认方向后启动推进'
  if (doing.length > 0) {
    curText = clean(doing[0].title, 54)
  } else if (blocked.length > 0) {
    curText = '正聚焦排查并疏通受阻目标：' + clean(blocked[0].title, 44)
  } else if (todo.length > 0) {
    curText = '准备推进下一项目标：' + clean(todo[0].title, 46)
  } else if (openPlan.length > 0) {
    curText = clean(openPlan[0].text, 54)
  } else if (done.length > 0 || (donePlan.length > 0 && !openPlan.length)) {
    curText = '本阶段核心事项已基本收尾，待核对确认后交卷'
  }

  let blockedText = '当前暂无受阻目标，推进链路顺畅'
  if (blocked.length > 0) {
    const b0 = blocked[0]
    blockedText = clean(b0.title, 40) + (b0.note ? '（症结：' + clean(b0.note, 34) + '）' : '（需排查卡点条件）')
  }

  let needWhatText = '前提条件与执行环境基本齐备，可按既定节奏完成验证与收尾'
  if (blocked.length > 0) {
    needWhatText = '需要先解除受阻卡点并补齐相关前置验证条件'
  } else if (todo.length > 0 && workers.some(w => w.status === 'running')) {
    needWhatText = '需要等当前并行协作收口并完成关键结果核验'
  } else if (todo.length > 0) {
    needWhatText = '需要按序完成剩余收尾环节与最终效果检验'
  } else if (openPlan.length > 0) {
    needWhatText = '需要推进或确认当前待完成环节：' + clean(openPlan[0].text, 40)
  } else if (!board || !board.objective) {
    needWhatText = '需要明确具体的最终验收标准或本轮预期效果'
  }

  const pendingBoundOrApproval = (Array.isArray(suggestions) ? suggestions : []).find(
    s => s && s.status === 'pending' && (s.kind === 'goal_approval' || s.kind === 'bound' || s.kind === 'advice'),
  )
  let userNeedText = '暂无需您额外提供，参谋长与主对话可继续自动推进'
  if (needFromUserHint) {
    userNeedText = clean(needFromUserHint, 54)
  } else if (pendingBoundOrApproval) {
    userNeedText = '请您查看并拍板确认「' + clean(pendingBoundOrApproval.title, 38) + '」'
  } else if (blocked.length > 0 && /权限|登录|账号|密钥|token|重启|确认|决定|选择/i.test(String(blocked[0].note || blocked[0].title || ''))) {
    userNeedText = '需要您协助授权、提供凭据或拍板选定解决路线'
  } else if (openPlan.length > 0 && /用户|确认|拍板|点头|决定|选择/.test(String(openPlan[0].text || ''))) {
    userNeedText = '需要您拍板选定下一步路线：' + clean(openPlan[0].text, 38)
  }

  let adviceText = '建议保持当前推进节奏，收口前做一轮完整实测核对即可交卷'
  if (pendingBoundOrApproval && pendingBoundOrApproval.kind === 'advice') {
    adviceText = clean(pendingBoundOrApproval.reason || pendingBoundOrApproval.draftText || pendingBoundOrApproval.title, 54)
  } else if (blocked.length > 0) {
    adviceText = '建议先集中解决首要受阻目标，必要时由参谋长向主对话插话纠偏'
  } else if (openPlan.length > 0 && doing.length === 0 && todo.length === 0) {
    adviceText = '建议按当前待定环节及时确认方向，确认后即可顺畅续跑'
  } else if (todo.length > 0) {
    adviceText = '建议优先收拢在手推进项，顺势拿下紧接的待办目标'
  } else if ((done.length > 0 || (donePlan.length > 0 && !openPlan.length)) && !doing.length && !todo.length) {
    adviceText = '建议您核对整体表现，满意后即可批准结项或开启下一目标'
  }

  return [
    '## 极简目标战报',
    `- 【🎯 总目标】${objText}`,
    `- 【🚀 当前推进目标】${curText}`,
    `- 【⛔ 受阻目标】${blockedText}`,
    `- 【🧰 需要什么】${needWhatText}`,
    `- 【🙋 用户需要提供什么】${userNeedText}`,
    `- 【💡 参谋长建议】${adviceText}`,
  ].join('\n')
}

export function summarizeSubagentsCompact(workers) {
  if (!Array.isArray(workers) || workers.length === 0) return ''
  const running = workers.filter(w => w.status === 'running')
  const idle = workers.filter(w => w.status !== 'running')
  const parts = []
  if (running.length > 0) {
    const detail = running.slice(0, 4).map(w => {
      const cleanTask = w.taskTitle && !isInternalCheckpointNoise(w.taskTitle) ? `（推进：${clamp(w.taskTitle, 28)}）` : ''
      return `@${shortAgentBriefName(w.name)}${cleanTask}`
    }).join('、')
    parts.push(`${running.length} 运行中：${detail}${running.length > 4 ? ' 等' : ''}`)
  }
  if (idle.length > 0) {
    if (running.length === 0 && idle.length <= 3) {
      parts.push(`待命：${idle.map(w => '@' + shortAgentBriefName(w.name)).join('、')}`)
    } else {
      parts.push(`${idle.length} 已结束/待命`)
    }
  }
  return `共 ${workers.length} 名子代理（${parts.join('；')}）`
}

function buildNarrativeInput({ board, facts, cluster, targets, peerProgress = [], archiveDigest = null }) {
  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const memory = (Array.isArray(board && board.memory) ? board.memory : [])
    .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))
  const anchors = (Array.isArray(board && board.notes) ? board.notes : []).filter(n => (n.tags || []).includes('anchor'))

  const lines = []
  if (board && board.objective) lines.push(`当前总目标：${board.objective}`)
  if ((bounds.forbidden || []).length) lines.push(`禁止红线：${bounds.forbidden.join('；')}`)
  if ((bounds.allowed || []).length) lines.push(`必做事项：${bounds.allowed.join('；')}`)
  if ((bounds.notes || []).length) lines.push(`边界注意：${bounds.notes.join('；')}`)

  if (cluster.length > 1) {
    lines.push(`跨窗口协同频道：当前已串联 ${cluster.length} 个主对话窗口协同作业（网络内自动共享进度）。`)
  }
  if (Array.isArray(peerProgress) && peerProgress.length > 0) {
    lines.push('', '【协同对话网络共享进度】')
    for (const p of peerProgress) {
      lines.push(`- 联动对话「${p.name}」[${p.status === 'running' ? '🟢运行中' : '⚪空闲'}]：目标="${p.objective || '未设'}" | 任务=${p.doneCount}完/${p.doingCount}做/${p.blockedCount}阻/${p.todoCount}待${p.cursorStep ? ` | 断点=${p.cursorStep}` : ''}`)
      if (Array.isArray(p.topTasks) && p.topTasks.length) {
        lines.push(`  · 在手任务：${p.topTasks.join('；')}`)
      }
      if (Array.isArray(p.recentConclusions) && p.recentConclusions.length) {
        lines.push(`  · 近期结论：${p.recentConclusions.join('；')}`)
      }
    }
  }
  const activeWorkers = targets.filter(t => t.kind === 'subagent' && !/^mnemon-(?:review|run)/i.test(String(t.name || t.key || '')))
  if (activeWorkers.length > 0) {
    lines.push(`子代理态势：${summarizeSubagentsCompact(activeWorkers)}`)
  }

  if (facts.length > 0) {
    lines.push('', '【持久记忆与纪律条目】')
    for (const f of facts) {
      lines.push(`- [${f.category}] ${f.text}`)
    }
  }

  if (anchors.length > 0) {
    lines.push('', '【关键锚点笔记】')
    for (const a of anchors.slice(0, 8)) {
      lines.push(`- ${a.title}：${clamp(a.body, 220)}`)
    }
  }

  if (tasks.length > 0) {
    const done = tasks.filter(t => t.status === 'done')
    const open = tasks.filter(t => t.status !== 'done')
    lines.push('', '【任务图态势】')
    for (const t of open.slice(0, 10)) {
      lines.push(`- 未完 [${t.status}] #${t.id} ${t.title}${t.owner ? '（@' + shortAgentBriefName(t.owner) + '）' : ''}${t.note ? '：' + clamp(t.note, 120) : ''}`)
    }
    for (const t of done.slice(-8)) {
      lines.push(`- 已完 #${t.id} ${t.title}${t.evidence ? '（证据：' + clamp(t.evidence, 140) + '）' : ''}`)
    }
  }

  if (memory.length > 0) {
    lines.push('', '【近期回合关键结论】')
    for (const m of memory.slice(-10)) {
      const cleaned = stripCheckpointNoise(m.title || m.text)
      if (cleaned) lines.push(`- [${m.section}] ${clamp(cleaned, 180)}`)
    }
  }

  if (archiveDigest) {
    const dSess = Array.isArray(archiveDigest.deskSessionItems) ? archiveDigest.deskSessionItems : []
    const dGlob = Array.isArray(archiveDigest.deskGlobalItems) ? archiveDigest.deskGlobalItems : []
    const dFlip = Array.isArray(archiveDigest.deskFlippedItems) ? archiveDigest.deskFlippedItems : []
    const mGlob = Array.isArray(archiveDigest.mountedGlobalItems) ? archiveDigest.mountedGlobalItems : []
    const sAll = Array.isArray(archiveDigest.sessionItems) ? archiveDigest.sessionItems : []
    const gHooks = Array.isArray(archiveDigest.globalHookIndex) ? archiveDigest.globalHookIndex : []
    const recentWatch = Array.isArray(archiveDigest.recentlyUnpinnedWatch) ? archiveDigest.recentlyUnpinnedWatch : []
    const deskAll = [
      ...dSess.map(it => `[桌面·本局(主可见)] 《${clamp(it.title, 40)}》：${clamp(it.summary || it.body, 140)}`),
      ...dGlob.map(it => `[桌面·全局(主可见)] 《${clamp(it.title, 40)}》：${clamp(it.summary || it.body, 140)}`),
      ...dFlip.map(it => `[桌面·冷藏已翻牌(主可见)] 《${clamp(it.title, 40)}》：${clamp(it.summary || it.rawBody, 140)}`),
    ]
    if (deskAll.length > 0) {
      lines.push('', '【当前认知桌面置顶（主对话与参谋长共同可见）】', ...deskAll.slice(0, 6).map(x => '- ' + x))
    }
    if (mGlob.length > 0) {
      lines.push('', '【参谋长已拉阅的全局档案（主对话不可见）】')
      for (const it of mGlob.slice(0, 5)) {
        lines.push(`- [全局参阅] 《${clamp(it.title, 40)}》：${clamp(it.summary || it.body, 120)}`)
      }
    }
    const vaultIndexLines = [
      ...sAll.filter(it => !it.takenOut).slice(0, 6).map(it => `- [本局档案·参谋随时可读] 《${clamp(it.title, 36)}》${it.hasHook ? '🪝[' + (it.hookKeywords || []).slice(0, 3).join('·') + ']' : '(待织钩)'}：${clamp(it.summary, 90)}`),
      ...gHooks.slice(0, 5).map(it => `- [全局钩子·参谋见钩可拉] 《${clamp(it.title, 36)}》🪝[${(it.hookKeywords || []).slice(0, 3).join('·')}] ${clamp(it.hookCue, 60)}`),
      ...recentWatch.slice(0, 3).map(w => `- [近期撤下桌面·待观察] 《${clamp(w.title, 36)}》`),
    ]
    if (vaultIndexLines.length > 0) {
      lines.push('', '【参谋长后台档案柜与钩子索引（未置顶桌面，主对话不注入）】', ...vaultIndexLines)
    }
  }

  return lines.join('\n').trim()
}

/** Deterministic structured bullet summary when no LLM key is configured or while first summary is warming up. */
function buildFallbackNarrative({ board, facts, targets, peerProgress = [], conciseBrief = false, suggestions = [] }) {
  const sections = []
  const tasks = Array.isArray(board && board.tasks) ? board.tasks : []
  const blocked = tasks.filter(t => t.status === 'blocked')
  const doing = tasks.filter(t => t.status === 'doing')
  const todo = tasks.filter(t => t.status === 'todo')
  const done = tasks.filter(t => t.status === 'done')
  const workers = targets.filter(t => t.kind === 'subagent' && !/^mnemon-(?:review|run)/i.test(String(t.name || t.key || '')))

  if (conciseBrief) {
    return buildConciseSixLineReport({ board, blocked, doing, todo, done, workers, suggestions })
  }

  const statusBullets = []
  if (board && board.objective) {
    statusBullets.push(`- 【总目标】${clamp(board.objective, 150)}`)
  }
  for (const b of blocked.slice(0, 4)) {
    statusBullets.push(`- 【受阻】${clamp(b.title, 70)}${b.note ? ' — ' + clamp(b.note, 70) : ''}`)
  }
  for (const d of doing.slice(0, 4)) {
    const who = d.subagent || d.owner ? `（@${shortAgentBriefName(d.subagent || d.owner)}）` : ''
    statusBullets.push(`- 【推进中】${clamp(d.title, 72)}${who}`)
  }
  if (tasks.length > 0) {
    statusBullets.push(`- 【任务进度】已完成 ${done.length} 项 / 推进中 ${doing.length} 项 / 受阻 ${blocked.length} 项 / 待推进 ${todo.length} 项`)
  }
  if (workers.length > 0) {
    statusBullets.push(`- 【子代理团队】${summarizeSubagentsCompact(workers)}`)
  }
  if (Array.isArray(peerProgress) && peerProgress.length > 0) {
    for (const p of peerProgress.slice(0, 4)) {
      statusBullets.push(`- 【协同进度·${clamp(p.name, 22)}】${p.objective ? clamp(p.objective, 70) + ' · ' : ''}任务 ${p.doneCount}完/${p.doingCount}做${p.blockedCount ? `/${p.blockedCount}阻` : ''}${p.cursorStep ? '（断点：' + clamp(p.cursorStep, 32) + '）' : ''}`)
    }
  }
  if (statusBullets.length > 0) {
    sections.push('## 核心目标与态势\n' + statusBullets.join('\n'))
  }

  const otherFacts = facts.filter(f => f.category !== 'discipline' && f.category !== 'preference')
  const mem = (Array.isArray(board && board.memory) ? board.memory : [])
    .filter(m => m && !isInternalCheckpointNoise(m.title || m.text))
    .slice(-5)
  const progressBullets = [
    ...otherFacts.slice(-5).map(f => `- 【结论】${clamp(stripCheckpointNoise(f.text), 130)}`),
    ...mem.map(m => `- 【进展】${clamp(stripCheckpointNoise(m.title || m.text), 120)}`),
  ]
  if (progressBullets.length > 0) {
    sections.push('## 关键结论与进展\n' + progressBullets.join('\n'))
  }

  const bounds = (board && board.bounds) || { allowed: [], forbidden: [], notes: [] }
  const disciplines = facts.filter(f => f.category === 'discipline' || f.category === 'preference')
  const ruleBullets = []
  for (const f of (bounds.forbidden || []).slice(0, 6)) ruleBullets.push(`- 【禁止红线】${clamp(f, 110)}`)
  for (const a of (bounds.allowed || []).slice(0, 4)) ruleBullets.push(`- 【必做事项】${clamp(a, 110)}`)
  for (const n of (bounds.notes || []).slice(0, 3)) ruleBullets.push(`- 【注意事项】${clamp(n, 110)}`)
  for (const d of disciplines.slice(-5)) ruleBullets.push(`- 【协作纪律】${clamp(d.text, 120)}`)
  if (ruleBullets.length > 0) {
    sections.push('## 协作纪律与边界\n' + ruleBullets.join('\n'))
  }

  if (sections.length === 0) {
    return '## 尚无沉淀摘要\n- 【状态】当前会话刚启动，暂未沉淀阶段结论或红线纪律\n- 【用法】可在下方参谋栏直接立规矩、查进展，或用一句话拆话调度主对话与各子代理'
  }
  return sections.join('\n\n')
}

export const summarizingLocks = new Map()

export async function getChiefView(deps, sessionId, { regenerate = false, autoSummarize = false, chatTriggered = false, syncHandoff = undefined, _skipAutoPilotCheck = false } = {}) {
  const rootId = deps.resolveRootSessionId(sessionId) || String(sessionId || 'global')
  const directory = await listPeerDirectory(deps, rootId)
  const board = deps.boardForSession(deps.boardFileFor(rootId))
  const state = loadChiefState()
  const view = clusterView(state, rootId)
  const modelsInfo = await listChiefModels(deps, false, rootId)
  const effCfgBefore = resolveWorkspaceConfig(state, rootId)
  const runMode = effCfgBefore.runMode || 'off'
  const isConciseBrief = Boolean(effCfgBefore.tacticalModes && effCfgBefore.tacticalModes.conciseBrief)
  const currentSig = view.clusterSig || computeClusterSig(directory.cluster)
  const peerProgress = directory.cluster.length > 1
    ? collectClusterPeerProgress(deps, directory.cluster, rootId)
    : []
  const archiveDigest = collectChiefVisibleArchives(deps, rootId, state)

  const rawInput = buildNarrativeInput({
    board,
    facts: view.facts,
    cluster: directory.cluster,
    targets: directory.targets,
    peerProgress,
    archiveDigest,
  })
  const inputHash = rawInput
    ? crypto.createHash('sha256').update(SUMMARY_FORMAT_REV + '\n' + (isConciseBrief ? 'concise:1' : 'concise:0') + '\n' + currentSig + '\n' + rawInput).digest('hex').slice(0, 24)
    : 'empty'

  const isClusterSigValid = (nar) => {
    if (!nar || !nar.text) return false
    if (nar.clusterSig && nar.clusterSig !== currentSig) return false
    if (!nar.clusterSig && directory.cluster.length > 1) return false
    return true
  }

  const hasSaved = isClusterSigValid(view.narrative)
  const lastSummaryAt = Number((view.narrative && view.narrative.at) || 0)
  const isFresh = !rawInput || (hasSaved && view.narrative.hash === inputHash)
  const cooledForAuto = Date.now() - lastSummaryAt >= AUTO_SUMMARY_COOLDOWN_MS
  const cooledForChat = Date.now() - lastSummaryAt >= CHAT_OPPORTUNISTIC_SUMMARY_COOLDOWN_MS
  const allowBackgroundSummary = runMode === 'managed' && autoSummarize && !isFresh && cooledForAuto
  const allowChatSummary = Boolean(chatTriggered) && !isFresh && cooledForChat

  // Opportunistically refresh stale narrative in background after Chief chats (60s debounce),
  // explicitly on Regenerate, or on autoSummarize cooldown.
  if (rawInput && (regenerate || allowBackgroundSummary || allowChatSummary) && modelsInfo.available && !summarizingLocks.has(rootId)) {
    const bgSummaryWorkId = getChiefActiveWork(rootId)
      ? ''
      : beginChiefActiveWork(rootId, { tone: 'neon', tab: 'chief', label: '参谋长正在自动提炼全局摘要中...' })
    const job = (async () => {
      const sysPrompt = isConciseBrief
        ? (NARRATIVE_SYSTEM + CONCISE_BRIEF_NARRATIVE_EXTRA)
        : NARRATIVE_SYSTEM
      const res = await callChiefLlm(deps, {
        sessionId: rootId,
        reasonKind: chatTriggered ? 'chat_summary' : 'auto_summary',
        system: sysPrompt,
        prompt: rawInput + (isConciseBrief
          ? '\n\n请开启【极简战报模式】：分结构列出多个简明短句，不写具体数字参数，精确概括现状：'
          : '\n\n请按上述规范输出简体中文摘要：'),
        maxTokens: SUMMARY_MAX_TOKENS,
      })
      if (res.ok && res.text) {
        const finalNarText = isConciseBrief ? sanitizeConciseBriefText(res.text) : res.text
        mutateChiefState((s) => {
          const ws = ensureWorkspace(s, rootId)
          ws.narrative = {
            hash: inputHash,
            text: finalNarText,
            at: Date.now(),
            byModel: res.modelRef || '',
            clusterSig: currentSig,
          }
        })
      }
    })().finally(() => {
      summarizingLocks.delete(rootId)
      if (bgSummaryWorkId) endChiefActiveWork(rootId, bgSummaryWorkId)
    })
    summarizingLocks.set(rootId, job)
    if (regenerate) {
      await job.catch(() => {})
    }
  }

  const latestState = loadChiefState()
  const latestView = clusterView(latestState, rootId)
  const hasLatestSaved = isClusterSigValid(latestView.narrative)
  const latestFresh = !rawInput || (hasLatestSaved && latestView.narrative.hash === inputHash)
  const narrativeText = (hasLatestSaved && (!isConciseBrief || latestFresh))
    ? (isConciseBrief ? sanitizeConciseBriefText(latestView.narrative.text) : latestView.narrative.text)
    : buildFallbackNarrative({ board, facts: latestView.facts, targets: directory.targets, peerProgress, conciseBrief: isConciseBrief, suggestions: latestView.suggestions })

  // Optional 1-click Handoff Packet Sync on Digest regeneration or explicit sync request (strictly blocked if pinned by human!)
  let handoffSyncResult = null
  const latestBoardBeforeSync = deps.boardForSession(deps.boardFileFor(rootId))
  const shouldSyncHandoff = syncHandoff !== undefined
    ? Boolean(syncHandoff)
    : Boolean(regenerate && latestBoardBeforeSync && latestBoardBeforeSync.handoff && latestBoardBeforeSync.handoff.syncOnDigest)
  if (shouldSyncHandoff && typeof deps.runAction === 'function') {
    const isPinned = Boolean(latestBoardBeforeSync && latestBoardBeforeSync.handoff && latestBoardBeforeSync.handoff.pinned)
    if (isPinned) {
      handoffSyncResult = {
        synced: false,
        skipped: 'pinned-by-human',
        reason: 'pinned',
        message: '交接单已被人工定住，参谋长跳过自动覆写',
      }
    } else {
      const composed = typeof deps.composeHandoffFromNarrative === 'function'
        ? deps.composeHandoffFromNarrative(rootId, narrativeText)
        : ''
      if (composed && composed.trim()) {
        const saveRes = deps.runAction({
          action: 'handoff.save',
          session: rootId === 'global' ? '' : rootId,
          by: 'chief',
          source: 'chief',
          text: composed,
        })
        const isLocked = Boolean(saveRes && (saveRes.pinned || saveRes.locked))
        handoffSyncResult = saveRes && saveRes.ok
          ? { synced: true, at: Date.now() }
          : {
              synced: false,
              ...(isLocked ? { skipped: 'pinned-by-human' } : {}),
              reason: isLocked ? 'pinned' : 'error',
              message: (saveRes && saveRes.error) || '同步失败',
            }
      }
    }
  }

  const ownWsBeforeStop = ensureWorkspace(latestState, rootId)
  const effectiveConfigBeforeStop = resolveWorkspaceConfig(latestState, rootId)
  if (
    !_skipAutoPilotCheck
    && rootId
    && rootId !== 'global'
    && (effectiveConfigBeforeStop.autoPilot || effectiveConfigBeforeStop.runMode === 'managed')
    && effectiveConfigBeforeStop.runMode === 'managed'
    && !effectiveConfigBeforeStop.stopped
  ) {
    if (idleAutoPilotHook) {
      await idleAutoPilotHook(deps, rootId, {
        allowStartupGrace: true,
        directory,
        currentFresh: latestFresh,
        fromViewCheck: true,
      }).catch(() => null)
    }
  }

  const finalState = loadChiefState()
  const finalView = clusterView(finalState, rootId)
  const ownWs = ensureWorkspace(finalState, rootId)
  const effectiveConfig = resolveWorkspaceConfig(finalState, rootId)
  const narrativeAt = hasLatestSaved
    ? (latestView.narrative.at || 0)
    : (ownWs.narrative && ownWs.narrative.at ? ownWs.narrative.at : (board.updatedAt || 0))
  const finalNarrativeText = ownWs.narrative && ownWs.narrative.text && (!isConciseBrief || latestFresh)
    ? (isConciseBrief ? sanitizeConciseBriefText(ownWs.narrative.text) : ownWs.narrative.text)
    : narrativeText
  return {
    ok: true,
    rootId,
    config: effectiveConfig,
    models: modelsInfo,
    narrative: {
      text: finalNarrativeText,
      at: narrativeAt,
      byModel: hasLatestSaved ? (latestView.narrative.byModel || '') : ((ownWs.narrative && ownWs.narrative.byModel) || ''),
      clusterSig: currentSig,
      isLiveZeroToken: !hasLatestSaved && !(ownWs.narrative && ownWs.narrative.text),
      hasUnsummarizedChanges: Boolean(rawInput && !latestFresh && !(ownWs.narrative && ownWs.narrative.hash === inputHash)),
      summarizing: summarizingLocks.has(rootId),
      fresh: latestFresh || Boolean(ownWs.narrative && ownWs.narrative.hash === inputHash),
    },
    ...(handoffSyncResult ? { handoffSyncResult } : {}),
    facts: finalView.facts.slice().reverse(),
    suggestions: finalView.suggestions.slice().reverse(),
    chat: finalView.chat.slice(-40).map((c) => {
      if (!c || typeof c !== 'object') return c
      const cleaned = stripToolCallMarkup(c.text || '')
      return cleaned !== c.text
        ? { ...c, text: cleaned || '（该条历史响应仅包含内部工具调用标记，已自动净化）' }
        : c
    }),
    mailbox: finalView.mailbox.slice(-30).reverse(),
    peers: directory.targets,
    otherSessions: directory.otherSessions,
    cluster: directory.cluster,
    peerProgress,
    flippedPrecipitatedIds: (ownWs.flippedPrecipitatedIds || []).slice(),
    runtimeGuard: { ...ownWs.runtimeGuard },
    chiefRiskAck: ownWs.chiefRiskAck ? { ...ownWs.chiefRiskAck } : null,
    pendingApprovals: (Array.isArray(ownWs.pendingApprovals) ? ownWs.pendingApprovals : []).slice(-15).reverse(),
    pendingElevation: ownWs.pendingElevation ? { ...ownWs.pendingElevation } : null,
    taskLedger: (Array.isArray(ownWs.taskLedger) ? ownWs.taskLedger : []).slice(-15).reverse(),
    inquiries: (Array.isArray(ownWs.inquiries) ? ownWs.inquiries : []).slice(-12).reverse(),
    guardWalls: listGuardWalls({ cwd: resolveSessionWorkspaceCwd(deps, rootId) }),
    activeWork: getChiefActiveWork(rootId),
    llmLedger: summarizeLlmLedger(ownWs.llmLedger, effectiveConfig),
    alertEvents: (Array.isArray(ownWs.alertEvents) ? ownWs.alertEvents : []).slice(-12),
    bubble: computeBubbleState(deps, rootId, finalState, directory),
    auditLog: (Array.isArray(ownWs.auditLog) ? ownWs.auditLog : []).slice(-50).reverse(),
  }
}
