/**
 * safety/command-analyzer.js
 *
 * Security command normalization, compound pipeline splitting, nested shell
 * unwrapping, and inline script payload extraction for DSH Chief.
 */

export function decodeEncodedPowerShell(command) {
  const decodedParts = []
  const raw = String(command || '')
  const re = /(?:^|\s)-(?:e|ec|en|enc|enco|encod|encode|encoded|encodedc|encodedco|encodedcom|encodedcomm|encodedcomma|encodedcomman|encodedcommand)\s+([A-Za-z0-9+/=]{8,})/gi
  let m
  while ((m = re.exec(raw)) !== null) {
    try {
      const buf = Buffer.from(m[1], 'base64')
      for (const enc of ['utf16le', 'utf8']) {
        const rawTxt = buf.toString(enc)
        if (/[\x00-\x08\x0e-\x1f\ufffd]/.test(rawTxt)) continue
        const txt = rawTxt.trim()
        if (txt.length >= 3 && /^[ -~\t\r\n\u4e00-\u9fff]+$/.test(txt)) {
          decodedParts.push(txt)
        }
      }
    } catch {}
  }
  return decodedParts.join(' ')
}

function extractCanonicalToolSubcommands(text) {
  const extras = []
  const s = String(text || '')
  const gitValFlags = new Set(['-c', '--git-dir', '--work-tree', '--namespace', '--config-env', '--exec-path', '-p', '--paginate'])
  const gitRe = /\bgit(?:\.exe)?\s+([^\n;|&`]+)/gi
  let gm
  while ((gm = gitRe.exec(s)) !== null) {
    const tokens = gm[1].trim().split(/\s+/).filter(Boolean)
    let i = 0
    while (i < tokens.length) {
      const tok = tokens[i]
      if (tok === '-C' || gitValFlags.has(tok)) {
        i += 2
        continue
      }
      if (tok.startsWith('-')) {
        i += 1
        continue
      }
      break
    }
    if (i < tokens.length) {
      const rest = tokens.slice(i).join(' ')
      extras.push(`git ${tokens[i]}`, `git ${rest}`)
    }
  }
  const npmRe = /\bnpm(?:\.cmd|\.exe)?\s+([^\n;|&`]+)/gi
  let nm
  while ((nm = npmRe.exec(s)) !== null) {
    const tokens = nm[1].trim().split(/\s+/).filter(Boolean)
    let i = 0
    while (i < tokens.length && tokens[i].startsWith('-')) {
      i += (tokens[i] === '--registry' || tokens[i] === '--tag' || tokens[i] === '--prefix') ? 2 : 1
    }
    if (i < tokens.length) {
      extras.push(`npm ${tokens.slice(i).join(' ')}`)
    }
  }
  return extras.join(' ')
}

export function normalizeCommandForSecurity(command) {
  const nfkc = String(command || '').normalize('NFKC')
  if (!nfkc) return ''
  const psDecoded = decodeEncodedPowerShell(nfkc)
  const base = psDecoded ? `${nfkc} ${psDecoded}` : nfkc
  let concatCollapsed = base
  for (let i = 0; i < 4; i += 1) {
    const next = concatCollapsed.replace(/['"`]\s*\+\s*['"`]/g, '')
    if (next === concatCollapsed) break
    concatCollapsed = next
  }
  const escapedQuotesUnwrapped = concatCollapsed
    .replace(/\\+(["'`])/g, '$1')
    .replace(/(["'`])\\+(?=[a-zA-Z0-9_.-])/g, '$1')
    .replace(/["'`]/g, '')
  const caretCollapsed = escapedQuotesUnwrapped.replace(/\^([a-zA-Z0-9_.-])/g, '$1')
  const quoteStripped = concatCollapsed.replace(/["'`]/g, '')
  const shellUnescaped = caretCollapsed.replace(/\\+([ \t!$&()*,.;<>?@[\]^`{|}~])/g, '$1')
  const spaceCollapsed = shellUnescaped.replace(/\s+/g, ' ').trim()
  const canonicalTools = [
    extractCanonicalToolSubcommands(spaceCollapsed),
    extractCanonicalToolSubcommands(caretCollapsed.replace(/\s+/g, ' ').trim()),
  ].filter(Boolean).join(' ')
  return [nfkc, psDecoded, concatCollapsed, quoteStripped, escapedQuotesUnwrapped, caretCollapsed, spaceCollapsed, canonicalTools]
    .filter(Boolean)
    .join(' \n ')
}

function unwrapOuterQuotes(text) {
  const s = String(text || '').trim()
  if (s.length >= 2) {
    const first = s[0]
    const last = s[s.length - 1]
    if ((first === '"' && last === '"') || (first === "'" && last === "'") || (first === '`' && last === '`')) {
      return s.slice(1, -1).trim()
    }
  }
  return s
}

function splitTopLevelShellSegments(input) {
  const s = String(input || '')
  const segments = []
  let cur = ''
  let quote = ''
  let escaped = false

  const flush = () => {
    const trimmed = cur.trim()
    if (trimmed) segments.push(trimmed)
    cur = ''
  }

  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i]
    const next = i + 1 < s.length ? s[i + 1] : ''
    const prev = i > 0 ? s[i - 1] : ''

    if (escaped) {
      cur += ch
      escaped = false
      continue
    }
    if (ch === '\\' && quote !== "'") {
      cur += ch
      escaped = true
      continue
    }
    if (quote) {
      cur += ch
      if (ch === quote) quote = ''
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      quote = ch
      cur += ch
      continue
    }

    if (ch === '\r' || ch === '\n' || ch === ';') {
      flush()
      continue
    }
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      flush()
      i += 1
      continue
    }
    if (ch === '|') {
      flush()
      continue
    }
    if (ch === '&') {
      // Preserve fd redirections like `2>&1`, `>&2`, `&>`
      if (prev === '>' || prev === '<' || next === '>') {
        cur += ch
        continue
      }
      flush()
      continue
    }
    cur += ch
  }
  flush()
  return segments
}

export function splitCompoundCommand(command, maxDepth = 4) {
  const out = []
  const seen = new Set()

  const walk = (raw, depth) => {
    const text = String(raw || '').normalize('NFKC').trim()
    if (!text || depth > maxDepth) return
    const psDecoded = decodeEncodedPowerShell(text)
    if (psDecoded) walk(psDecoded, depth + 1)

    const segs = splitTopLevelShellSegments(text)
    for (const seg of segs) {
      if (!seen.has(seg)) {
        seen.add(seg)
        out.push(seg)
      }
      if (depth >= maxDepth) continue

      const cmdMatch = seg.match(/^(?:call\s+)?cmd(?:\.exe)?\s+\/[ck]\s+([\s\S]+)$/i)
      if (cmdMatch && cmdMatch[1]) {
        walk(unwrapOuterQuotes(cmdMatch[1]), depth + 1)
      }
      const psMatch = seg.match(/^(?:powershell|pwsh)(?:\.exe)?\b(?:\s+-[a-zA-Z0-9_-]+(?:\s+(?!-)[a-zA-Z0-9_.-]+)?)*?\s+-(?:c|command)\s+([\s\S]+)$/i)
      if (psMatch && psMatch[1]) {
        walk(unwrapOuterQuotes(psMatch[1]), depth + 1)
      }
      const shMatch = seg.match(/^(?:bash|sh|zsh|dash)(?:\.exe)?\s+-[a-z]*c\s+([\s\S]+)$/i)
      if (shMatch && shMatch[1]) {
        walk(unwrapOuterQuotes(shMatch[1]), depth + 1)
      }
    }
  }

  walk(command, 0)
  return out
}

function decodeBase64Literals(scriptText) {
  const decoded = []
  const s = String(scriptText || '')
  const patterns = [
    /Buffer\.from\s*\(\s*['"]([A-Za-z0-9+/=]{4,})['"]\s*,\s*['"]base64['"]\s*\)/gi,
    /\batob\s*\(\s*['"]([A-Za-z0-9+/=]{4,})['"]\s*\)/gi,
    /FromBase64String\s*\(\s*['"]([A-Za-z0-9+/=]{4,})['"]\s*\)/gi,
  ]
  for (const re of patterns) {
    let m
    while ((m = re.exec(s)) !== null) {
      try {
        const buf = Buffer.from(m[1], 'base64')
        for (const enc of ['utf8', 'utf16le']) {
          const txt = buf.toString(enc).trim()
          if (txt.length >= 2 && !/[\x00-\x08\x0e-\x1f\ufffd]/.test(txt)) {
            decoded.push(txt)
          }
        }
      } catch {}
    }
  }
  return decoded
}

function readQuotedOrRestArg(text, startIdx) {
  let i = startIdx
  while (i < text.length && /\s/.test(text[i])) i += 1
  if (i >= text.length) return ''
  const first = text[i]
  if (first === '"' || first === "'" || first === '`') {
    let escaped = false
    let body = ''
    for (let j = i + 1; j < text.length; j += 1) {
      const ch = text[j]
      if (escaped) {
        body += ch
        escaped = false
        continue
      }
      if (ch === '\\' && first !== "'") {
        body += ch
        escaped = true
        continue
      }
      if (ch === first) {
        return body
      }
      body += ch
    }
    return body
  }
  return text.slice(i).trim()
}

export function extractInlineScriptPayloads(command) {
  const segments = splitCompoundCommand(command)
  const payloads = []
  const seen = new Set()
  let hasInlineExec = false
  let hasInlineSubprocess = false

  const addPayload = (rawBody) => {
    const body = String(rawBody || '').trim()
    if (!body) return
    const normalized = body.replace(/(['"`])\s*\+\s*\1/g, '').replace(/\\(["'`])/g, '$1')
    for (const candidate of [body, normalized, ...decodeBase64Literals(body), ...decodeBase64Literals(normalized)]) {
      const c = String(candidate || '').trim()
      if (c && !seen.has(c)) {
        seen.add(c)
        payloads.push(c)
      }
      if (/\b(?:child_process|execSync|execFileSync|spawnSync|os\.system|os\.popen|subprocess\.|Start-Process|ShellExecute)\b/i.test(c)) {
        hasInlineSubprocess = true
      }
    }
  }

  for (const seg of segments) {
    const inlineMatchers = [
      /\bnode(?:\.exe)?\b[^\n]*?\s(?:--eval|--print|-e|-p)\s+/gi,
      /\b(?:python3?|py)(?:\.exe)?\b[^\n]*?\s-c\s+/gi,
      /\b(?:powershell|pwsh)(?:\.exe)?\b[^\n]*?\s-(?:c|command)\s+/gi,
      /\b(?:deno\s+eval|bun\s+-e|ruby\s+-e|perl\s+-e|php\s+-r)\s+/gi,
    ]
    for (const re of inlineMatchers) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(seg)) !== null) {
        hasInlineExec = true
        const argBody = readQuotedOrRestArg(seg, m.index + m[0].length)
        addPayload(argBody)
      }
    }

    const iexRe = /\b(?:Invoke-Expression|iex)\b\s*([\s\S]+)$/i
    const iexM = seg.match(iexRe)
    if (iexM && iexM[1]) {
      hasInlineExec = true
      addPayload(unwrapOuterQuotes(iexM[1]))
    }
  }

  return {
    payloads,
    hasInlineExec,
    hasInlineSubprocess,
  }
}

export function analyzeCommand(command) {
  const raw = String(command || '')
  const segments = splitCompoundCommand(raw)
  const inline = extractInlineScriptPayloads(raw)
  const normalizedSegments = segments.map(seg => normalizeCommandForSecurity(seg)).filter(Boolean)
  const normalizedInline = inline.payloads.map(p => normalizeCommandForSecurity(p)).filter(Boolean)
  const normalized = [
    normalizeCommandForSecurity(raw),
    ...normalizedSegments,
    ...normalizedInline,
  ].filter(Boolean).join(' \n ')

  return {
    raw,
    normalized,
    segments,
    inlinePayloads: inline.payloads,
    hasInlineExec: inline.hasInlineExec,
    hasInlineSubprocess: inline.hasInlineSubprocess,
  }
}
