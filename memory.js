/**
 * Conversation memory for dsh-chief.
 *
 * The board already holds hand-written notes; this file is the other half:
 * a rolling memory of what this conversation actually did, one entry per turn,
 * written from the Session event log the moment a turn stops. Two consumers
 * read it — the `记忆` tab in the panel and the digest the agent gets back —
 * so the extraction, the classification and the local question answering all
 * live here instead of being duplicated in index.js and client.js.
 *
 * Everything in this module is pure: it takes a board (or a Session) and returns
 * plain values, so the host half and the self-test can both drive it without a
 * live agent.
 */

export const MEMORY_CAP = 120
export const MEMORY_TEXT = 700
const MEMORY_HEADLINE = 80
const SNIPPET_RADIUS = 60
const ANSWER_HITS = 5

/** Sections are ordered: the first hint that matches a turn decides its bucket. */
export const MEMORY_SECTIONS = [
  {
    key: 'progress',
    label: '目标与进展',
    hints: ['目标', '计划', '下一步', '进展', '推进', '完成', '开始', '继续', '现在'],
  },
  {
    key: 'decision',
    label: '决策与结论',
    hints: ['决定', '选择', '结论', '确认', '改为', '采用', '放弃', '原因', '因为', '所以'],
  },
  {
    key: 'verify',
    label: '门禁与验证',
    hints: ['测试', '通过', '失败', '校验', '验证', '部署', 'PASS', 'FAIL', 'exit', '自检'],
  },
  {
    key: 'open',
    label: '未完成与风险',
    hints: ['待办', 'todo', '还没', '未完成', '风险', '卡住', '还剩', '问题', '缺'],
  },
  { key: 'other', label: '其他要点', hints: [] },
]

const SECTION_KEYS = MEMORY_SECTIONS.map(section => section.key)

let counter = 0

function newMemoryId() {
  counter = (counter + 1) % 100000
  return 'mem-' + Date.now().toString(36) + '-' + counter.toString(36)
}

function clampText(value, limit) {
  const text = String(value == null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
  if (text.length <= limit) return text
  return text.slice(0, Math.max(0, limit - 1)) + '…'
}

/**
 * Memory is read in a narrow panel and searched by plain words, so markdown
 * decoration only costs space: `## 结论` becomes `结论`, `**加粗**` loses its
 * asterisks, links keep their label. Emoji at the start of a line is dropped
 * too — it survives in the conversation, it just does not belong in a headline.
 */
function stripMarkup(value) {
  return String(value == null ? '' : value)
    .replace(/```[^`]*```/g, ' ')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]*)\)/g, '$1')
    .replace(/^\s*(?:[#>|-]+|\*{1,3}|_{1,3})\s*/gm, ' ')
    .replace(/\*\*|__|\*/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\r/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The Session log stores two message shapes: `assistant/message` puts the
 * message under `data.message`, while `user/message` puts the message fields
 * (`role`/`content`/`source`) directly on `data`. Read whichever one this
 * event uses instead of assuming `data.message` always exists.
 */
function eventMessage(data) {
  if (!data || typeof data !== 'object') return null
  if (data.message && typeof data.message === 'object') return data.message
  if (Array.isArray(data.content) || typeof data.content === 'string') return data
  return null
}

/** Nothing but the human's own words; runtime context and tool results are noise. */
function isHumanMessage(message) {
  const source = message && typeof message === 'object' ? message.source : null
  if (!source || typeof source !== 'object') return true
  return typeof source.kind === 'string' ? source.kind === 'user' : true
}

function messageText(message, skipReasoning) {
  if (!message || typeof message !== 'object') return ''
  const content = message.content
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const spoken = []
  const thought = []
  for (const block of content) {
    if (!block || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') {
      spoken.push(block.text)
    } else if (block.type === 'reasoning' && typeof block.text === 'string') {
      thought.push(block.text)
    }
  }
  const own = spoken.join('\n')
  if (own.trim() !== '' || skipReasoning) return own
  return thought.join('\n')
}

/** Take the first few sentences rather than one long paragraph. */
function leadingSentences(text, limit, maxSentences) {
  const flat = String(text || '')
    .replace(/\r/g, '')
    .replace(/\n+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (flat === '') return ''
  const sentences = flat.split(/(?<=[。！？!?])/)
  const picked = []
  let used = 0
  for (const sentence of sentences) {
    const piece = sentence.trim()
    if (piece === '') continue
    if (picked.length >= maxSentences) break
    if (used + piece.length > limit) break
    picked.push(piece)
    used += piece.length
  }
  const joined = picked.join(' ')
  if (joined === '') return clampText(flat, limit)
  return clampText(joined, limit)
}

/**
 * A headline is the first sentence, plus the next one when the first is just a
 * lead-in ("关键发现！") that carries no subject on its own.
 */
function headlineText(value, limit) {
  const flat = stripMarkup(value)
  if (flat === '') return ''
  const sentences = flat.split(/(?<=[。！？!?])/).map(piece => piece.trim()).filter(Boolean)
  if (sentences.length === 0) return clampText(flat, limit)
  let picked = sentences[0]
  if (picked.length < 24 && sentences.length > 1) picked = picked + ' ' + sentences[1]
  return clampText(picked, limit)
}

/**
 * A turn's own closing line is usually courtesy ("你现在看到的这段就是修好之后
 * 的样子"), while the thing worth keeping is the finding a few sentences earlier.
 * So instead of taking the last message verbatim, score the sentences of the
 * last message and keep the densest run of them: concrete nouns (paths, commands,
 * numbers, hash/PASS/FAIL), causal words, and the absence of pleasantries.
 */
const PLEASANTRY = ['谢谢', '感谢', '希望', '随时', '不客气', '祝', '有什么', '可以继续', '你现在看到', '我在这里', '已完成，用时']

/**
 * Prompts that carry no question of their own. When a turn's only text is one
 * of these, echoing it back spends one of the 120 memory slots on a line that
 * says nothing — a real board ended up with "继续" twenty turns in a row and
 * the findings that answered it had aged out from under them.
 */
const TRIVIAL_ASK = /^(继续|继续吧|接着|接着做|接着干|好的?|好啊|行|嗯|哦|收到|可以|开始吧|来吧|go on|continue|ok|okay)[。！!，,、.…~\s]*$/i
const EVIDENCE = ['/', '\\', 'PASS', 'FAIL', 'exit', 'http', 'node ', 'npm ', 'git ', '因为', '所以', '原因', '根因', '结论', '验证', '已修', '已部署', '实测', '确认']

function conclusionSentences(text, limit) {
  const flat = stripMarkup(text)
  if (flat === '') return ''
  const sentences = flat.split(/(?<=[。！？!?])/).map(piece => piece.trim()).filter(Boolean)
  if (sentences.length <= 1) return clampText(flat, limit)

  const score = sentences.map((sentence) => {
    let value = 0
    for (const word of EVIDENCE) if (sentence.includes(word)) value += 2
    for (const word of PLEASANTRY) if (sentence.includes(word)) value -= 3
    if (/[0-9]/.test(sentence)) value += 1
    if (sentence.length >= 12) value += 1
    return value
  })

  // The best sentence, widened by its neighbours while the budget allows: a
  // finding rarely survives being cut off from the sentence that explains it.
  let best = 0
  for (let i = 1; i < score.length; i += 1) if (score[i] > score[best]) best = i
  const picked = [sentences[best]]
  let used = sentences[best].length
  for (const step of [1, -1, 2, -2]) {
    const index = best + step
    if (index < 0 || index >= sentences.length) continue
    if (score[index] < 0) continue
    if (used + sentences[index].length > limit) continue
    picked.push(sentences[index])
    used += sentences[index].length
  }
  return clampText(picked.join(' '), limit)
}

/** Which bucket a turn's text belongs to; first matching section wins. */
export function classifySection(text) {  const value = String(text || '').toLowerCase()
  if (value === '') return 'other'
  for (const section of MEMORY_SECTIONS) {
    if (section.hints.length === 0) continue
    for (const hint of section.hints) {
      if (value.includes(hint.toLowerCase())) return section.key
    }
  }
  return 'other'
}

/** Event log → the turns that fall inside `turn`, newest last. */
function eventsOfTurn(session, turn) {
  if (!session || typeof session.snapshotEvents !== 'function') return []
  const wanted = Number(turn)
  let all = []
  try {
    all = session.snapshotEvents() || []
  } catch {
    return []
  }
  if (!Array.isArray(all) || all.length === 0) return []
  const tail = all.length > 4000 ? all.slice(-4000) : all
  const out = []
  for (const event of tail) {
    if (!event || !event.data) continue
    const eventTurn = Number(event.data.turn)
    if (Number.isFinite(eventTurn) && eventTurn !== wanted) continue
    out.push(event)
  }
  return out
}

/**
 * The memory entry for one turn: what was asked, what the model said, which
 * tools it used. Returns null when the turn left no usable text at all (a
 * pure tool-call turn is still worth remembering through its tool names).
 */
export function captureTurn(session, turn, fallbackTools) {
  const wanted = Number(turn)
  if (!Number.isFinite(wanted) || wanted <= 0) return null
  const events = eventsOfTurn(session, wanted)
  let asked = ''
  const said = []
  const tools = []
  for (const event of events) {
    if (event.type === 'user/message') {
      const message = eventMessage(event.data)
      if (!isHumanMessage(message)) continue
      const text = messageText(message, true)
      if (text.trim() !== '' && asked === '') asked = text
    } else if (event.type === 'assistant/message') {
      // Reasoning is not output. A model that thinks privately and prints
      // nothing has told the reader nothing, and its scratchpad is not a
      // conclusion: scoring it filed fragments like "no). Let's edit. Now
      // verify syntax and re-run checks." as the finding of that turn. Only the
      // visible text counts, which is the same rule the idle guard applies when
      // it decides a turn produced 0 字.
      const text = messageText(eventMessage(event.data), true)
      if (text.trim() !== '') said.push(text)
    } else if (event.type === 'tool/call') {
      const name = typeof event.data.name === 'string' ? event.data.name : ''
      if (name !== '') tools.push(name)
    }
  }
  const toolList = tools.length > 0 ? tools : Array.isArray(fallbackTools) ? fallbackTools : []
  // Score the whole turn, not just its last message: the conclusion often sits
  // in a middle paragraph while the closing line is courtesy.
  const spoken = stripMarkup(said.join(' '))
  const askedText = stripMarkup(asked)
  // A bare "继续" carries no question of its own, so it is neither a finding nor
  // a label: echoing it back filled a real board with twenty identical lines and
  // pushed the findings that answered them out of the 120-entry cap. A turn that
  // at least ran tools still has those names to speak for it.
  const askBody = TRIVIAL_ASK.test(askedText) ? '' : askedText
  const body = spoken !== ''
    ? conclusionSentences(spoken, MEMORY_TEXT)
    : askBody !== ''
      ? leadingSentences(askBody, MEMORY_TEXT, 2)
      : ''
  if (body === '' && toolList.length === 0) return null
  const text = body !== '' ? body : '这一轮只调用了工具：' + toolList.slice(0, 6).join('、')
  // The headline describes the entry under it, so it comes from the stored text
  // rather than from the question — otherwise a tool-only turn is filed under
  // whatever the user happened to type.
  const headline = headlineText(text, MEMORY_HEADLINE)
  const unique = []
  for (const name of toolList) {
    const short = clampText(name, 32)
    if (short !== '' && !unique.includes(short)) unique.push(short)
  }
  return {
    id: newMemoryId(),
    at: Date.now(),
    turn: wanted,
    section: classifySection(text + ' ' + askedText),
    title: headline,
    text: clampText(text, MEMORY_TEXT),
    tools: unique.slice(0, 8),
    by: 'auto',
    session: '',
  }
}

/** Stored shape, with every field the readers rely on guaranteed. */
export function normalizeMemory(list) {
  if (!Array.isArray(list)) return []
  const out = []
  for (const raw of list) {
    const item = raw && typeof raw === 'object' ? raw : {}
    // Markup is stripped on the way in so entries written before this rule
    // existed are cleaned up the next time the board is read.
    const text = clampText(stripMarkup(typeof item.text === 'string' ? item.text : ''), MEMORY_TEXT)
    if (text === '') continue
    const tools = Array.isArray(item.tools)
      ? item.tools.filter(name => typeof name === 'string' && name !== '').slice(0, 8).map(name => clampText(name, 32))
      : []
    const by = typeof item.by === 'string' ? item.by : 'auto'
    // Entries the old rule wrote before TRIVIAL_ASK existed: a bare prompt
    // echoed back as if it were the finding. Dropping them on read is what gives
    // a board that already spent its cap on "继续" its room back — a real one had
    // 29 copies in a row, all of them the user's word and nothing else. The tool
    // list does not rescue an entry here: naming the tool that ran instead of
    // answering adds no finding, and a turn that did run work now stores
    // "这一轮只调用了工具：bash", which is not trivial and survives. A
    // human-written entry is never touched, because deciding that a person's own
    // note was noise is not this module's call.
    if (by === 'auto' && TRIVIAL_ASK.test(text)) continue
    const turn = Number(item.turn)
    out.push({
      id: typeof item.id === 'string' && item.id !== '' ? item.id : newMemoryId(),
      at: typeof item.at === 'number' && Number.isFinite(item.at) ? item.at : Date.now(),
      turn: Number.isFinite(turn) ? turn : 0,
      section: SECTION_KEYS.includes(item.section) ? item.section : 'other',
      title: clampText(stripMarkup(typeof item.title === 'string' ? item.title : ''), MEMORY_HEADLINE),
      text,
      tools,
      by,
      session: typeof item.session === 'string' ? item.session : '',
    })
  }
  return out.slice(-MEMORY_CAP)
}

/** Append one entry, keeping the oldest ones out of the way at the cap. */
export function appendMemory(board, entry) {
  if (!board || !entry) return board
  if (!Array.isArray(board.memory)) board.memory = []
  if (entry.turn > 0 && board.memory.some(item => item.turn === entry.turn && item.by === 'auto')) {
    return board
  }
  board.memory.push(normalizeMemory([entry])[0] || entry)
  if (board.memory.length > MEMORY_CAP) board.memory = board.memory.slice(-MEMORY_CAP)
  return board
}

/** The panel's shape: fixed section order, newest entry first inside each. */
export function memorySections(board, perSection) {
  const limit = Number.isFinite(Number(perSection)) ? Number(perSection) : 6
  const memory = board && Array.isArray(board.memory) ? board.memory : []
  return MEMORY_SECTIONS.map(section => {
    const items = memory
      .filter(item => item.section === section.key)
      .slice(-Math.max(1, limit))
      .reverse()
    return { key: section.key, label: section.label, items }
  }).filter(section => section.items.length > 0)
}

/** Cheap local search over memory, so the panel answers without a model. */
export function searchMemory(board, term) {
  const needle = String(term || '').trim().toLowerCase()
  if (needle === '') return []
  const memory = board && Array.isArray(board.memory) ? board.memory : []
  const hits = []
  for (const item of memory) {
    const haystack = (item.title + ' ' + item.text + ' ' + item.tools.join(' ')).toLowerCase()
    const at = haystack.indexOf(needle)
    if (at < 0) continue
    hits.push({
      kind: '记忆',
      id: item.id,
      title: item.title || clampText(item.text, 40),
      section: item.section,
      turn: item.turn,
      snippet: snippetOf(item.text, needle, SNIPPET_RADIUS),
    })
  }
  return hits.reverse().slice(0, ANSWER_HITS)
}

function snippetOf(source, needle, radius) {
  const text = String(source || '')
  const at = text.toLowerCase().indexOf(needle)
  if (at < 0) return clampText(text, radius * 2)
  const from = Math.max(0, at - radius)
  const to = Math.min(text.length, at + needle.length + radius)
  return (from > 0 ? '…' : '') + text.slice(from, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '')
}

/** Question words carry no signal; drop them before matching. */
const STOP_WORDS = ['的', '了', '吗', '呢', '是', '在', '有', '和', '跟', '就', '都', '也', '很', '还', '要', '我', '你', '它', '这', '那', '个', '把', '被', '给', '对', '从', '到', '为什么', '什么', '怎么', '如何', '哪里', '哪个', '多少', '现在', '一下', '可以', '是不是']

const CJK_PATTERN = /[\u3400-\u9fff]/

function terms(question) {
  const flat = String(question || '').toLowerCase()
  const words = flat
    .split(/[\s,，。！？!?、;；:：()（）"'“”‘’]+/)
    .map(word => word.trim())
    .filter(word => word !== '' && !STOP_WORDS.includes(word))
  const out = []
  for (const word of words) {
    // Chinese is written without spaces, so a whole question usually arrives as
    // one run of characters that matches no stored entry verbatim. Sliding
    // two-character grams are the closest thing to words available here: they
    // still rank an entry that shares a real phrase with the question, and a
    // question that shares nothing scores zero either way.
    if (CJK_PATTERN.test(word) && word.length > 2) {
      for (let at = 0; at + 2 <= word.length; at += 1) {
        const gram = word.slice(at, at + 2)
        if (!STOP_WORDS.includes(gram)) out.push(gram)
      }
      continue
    }
    if (word.length >= 2 || /[a-z0-9]/i.test(word)) out.push(word)
  }
  return out.slice(0, 12)
}

/**
 * Answer strictly from what the board remembers. No model call: the reply is
 * a ranked list of the entries that matched, and an empty answer says so
 * plainly instead of inventing one.
 */
export function answerMemory(board, question) {
  const asked = String(question || '').trim()
  if (asked === '') return { ok: false, reply: '问一句具体的话，我按记忆里的条目查。', hits: [], terms: [] }
  const needles = terms(asked)
  if (needles.length === 0) needles.push(asked.toLowerCase())
  const memory = board && Array.isArray(board.memory) ? board.memory : []
  // A long question yields many grams, so one shared bigram is weak evidence:
  // demand a second match before calling it relevant.
  const floor = needles.length >= 6 ? 2 : 1
  const scored = []
  for (const item of memory) {
    const haystack = (item.title + ' ' + item.text + ' ' + item.tools.join(' ') + ' ' + item.section).toLowerCase()
    let score = 0
    for (const needle of needles) {
      if (haystack.includes(needle)) score += 1
    }
    if (score < floor) continue
    scored.push({ item, score })
  }
  scored.sort((a, b) => b.score - a.score || b.item.at - a.item.at)
  const hits = scored.slice(0, ANSWER_HITS).map(({ item }) => ({
    kind: '记忆',
    id: item.id,
    title: item.title || clampText(item.text, 40),
    section: item.section,
    turn: item.turn,
    snippet: clampText(item.text, SNIPPET_RADIUS * 2),
  }))
  if (hits.length === 0) {
    return {
      ok: true,
      reply: memory.length === 0
        ? '本对话还没有记忆条目：聊过一轮之后我会自己攒。'
        : '记忆里没有这条。可以让我在对话里查一次，或者直接用「更新记忆」写一条。',
      hits: [],
      terms: needles,
    }
  }
  const lines = hits.map((hit, index) => (index + 1) + '. [' + sectionLabel(hit.section) + '] ' + hit.title + '：' + hit.snippet)
  return {
    ok: true,
    reply: '记忆里这几条最相关（' + memory.length + ' 条里挑出 ' + hits.length + ' 条）：\n' + lines.join('\n'),
    hits,
    terms: needles,
  }
}

export function sectionLabel(key) {
  const found = MEMORY_SECTIONS.find(section => section.key === key)
  return found ? found.label : '其他要点'
}

/** One compact block for the injected digest; empty when nothing was remembered. */
export function renderMemoryDigest(board, limit) {
  const budget = Number.isFinite(Number(limit)) ? Number(limit) : 600
  const memory = board && Array.isArray(board.memory) ? board.memory : []
  if (memory.length === 0) return ''
  const lines = ['记忆（本对话自动累积 ' + memory.length + ' 条，最新的在前）']
  let used = lines[0].length
  for (const section of memorySections(board, 2)) {
    for (const item of section.items) {
      const line = '  · [' + section.label + '] ' + clampText(item.title || item.text, 60) + ' — ' + clampText(item.text, 80)
      if (used + line.length > budget) return lines.join('\n') + '\n  …（摘要已截断，用 chief_memory 取全量）'
      lines.push(line)
      used += line.length + 1
    }
  }
  return lines.join('\n')
}
