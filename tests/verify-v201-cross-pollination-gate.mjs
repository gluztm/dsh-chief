#!/usr/bin/env node
/**
 * Cross-Pollination Regression Gate (`X1-X4`) for dsh-chief
 * Verifies capabilities adopted from hakimi-memory without touching ~/.dsh or safety kernels:
 *  - X1: Bilingual CJK + Latin BM25 archive ranking & copper down-weighting
 *  - X2: Evolution snapshots (`history[]` cap 5) on save/sameTitle/curate + `rollbackHistory`
 *  - X3: WikiLinks `[[...]]` auto-extraction, `relations` (outgoing/incoming/staleDependencies) & `setClip('copper')` `affectedDependents`
 *  - X4: Multi-protocol Embedding Client (OpenAI / Ollama + 404 legacy fallback / Gemini header auth)
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PKG = path.resolve(__dirname, '..')

const {
  applyChiefArchiveCurations,
  getArchiveDetail,
  listArchiveHeaders,
  mutateArchive,
  searchArchives,
} = await import(pathToFileURL(path.join(PKG, 'archives.js')).href)

const { normalizeExternalMemoryConfig } = await import(pathToFileURL(path.join(PKG, 'state-schema.js')).href)
const { fetchEmbeddingVectors, probeEmbeddingApi } = await import(pathToFileURL(path.join(PKG, 'external-memory-studio.js')).href)

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-chief-x201-'))
const targetOpt = {
  customSharedBoardFile: path.join(tmpRoot, 'shared-board.json'),
  cwd: tmpRoot,
  projectKey: 'proj-x201',
  rootSessionId: 'sess-x201-main',
  vaultScope: 'session',
}

function runX1ToX3() {
  // X1: Bilingual BM25 search without spaces in CJK query + copper down-weight
  const goldDoc = mutateArchive({
    op: 'save',
    title: '认证令牌刷新锁契约',
    folder: 'contracts',
    paperclip: 'gold',
    tags: ['auth', 'lock'],
    body: '采用分布式幂等令牌锁防止高并发刷新冲突，核心路由在 src/auth-router.ts。',
  }, targetOpt)
  assert.equal(goldDoc.ok, true)

  const copperDoc = mutateArchive({
    op: 'save',
    title: '旧版认证令牌刷新机制',
    folder: 'incidents',
    paperclip: 'copper',
    tags: ['auth'],
    body: '旧版文件实现存在认证令牌刷新锁并发覆盖，现已作废改用 [[认证令牌刷新锁契约]]。',
  }, targetOpt)
  assert.equal(copperDoc.ok, true)

  const bm25Hit = searchArchives('高并发认证令牌刷新锁', {}, targetOpt)
  assert.equal(bm25Hit.ok, true)
  assert.ok(bm25Hit.matchCount >= 2, 'X1 unspaced Chinese query must recall both matching dossiers')
  assert.equal(bm25Hit.hits[0].id, goldDoc.item.id, 'X1 gold active dossier must outrank superseded copper dossier')
  assert.ok(bm25Hit.hits.some(h => h.id === copperDoc.item.id), 'X1 copper dossier must remain searchable for warning')
  assert.ok(bm25Hit.hits[0].score > bm25Hit.hits[1].score, 'X1 BM25 scores must be populated and ordered')

  // X2: Evolution history[] snapshots on save, sameTitle upsert, curate, and rollbackHistory
  for (let v = 1; v <= 7; v += 1) {
    const up = mutateArchive({
      op: 'save',
      id: goldDoc.item.id,
      body: `第 ${v} 版契约正文：严格遵守无锁竞态校验 TokenVersion=${v}。`,
      by: v % 2 === 0 ? 'chief' : 'user',
    }, targetOpt)
    assert.equal(up.ok, true)
  }
  const curated = applyChiefArchiveCurations([
    { id: goldDoc.item.id, summary: '整理后的最新第8版摘要', tags: ['auth', 'lock', 'curated'] },
  ], [], targetOpt)
  assert.equal(curated.updatedCount, 1)

  const detailBeforeRollback = getArchiveDetail(goldDoc.item.id, targetOpt.rootSessionId, targetOpt)
  assert.equal(detailBeforeRollback.ok, true)
  assert.equal(detailBeforeRollback.item.history.length, 5, 'X2 history[] must cap at 5 snapshots')
  assert.ok(detailBeforeRollback.item.body.includes('TokenVersion=7'))

  // Rollback to index 1 (Version 6, because index 0 is pre-curation Version 7)
  const rolled = mutateArchive({ op: 'rollbackHistory', id: goldDoc.item.id, versionIndex: 1 }, targetOpt)
  assert.equal(rolled.ok, true)
  assert.ok(rolled.item.body.includes('TokenVersion=6'), 'X2 rollbackHistory must restore selected version body')

  // X3: WikiLinks [[...]] relations (outgoing / incoming / staleDependencies) & copper dependency alert
  const consumerDoc = mutateArchive({
    op: 'save',
    title: '网关并发压测脚本',
    folder: 'coords',
    paperclip: 'silver',
    body: '本压测脚本参考 [[旧版认证令牌刷新机制]] 与 [[认证令牌刷新锁契约]]。',
  }, targetOpt)
  assert.equal(consumerDoc.ok, true)

  const consumerDetail = getArchiveDetail(consumerDoc.item.id, targetOpt.rootSessionId, targetOpt)
  assert.equal(consumerDetail.ok, true)
  assert.equal(consumerDetail.item.relations.outgoing.length, 2, 'X3 outgoing wikilinks must resolve both targets')
  assert.equal(consumerDetail.item.relations.staleDependencies.length, 1, 'X3 must flag copper dependency in staleDependencies')
  assert.equal(consumerDetail.item.relations.staleDependencies[0].id, copperDoc.item.id)

  const goldDetail = getArchiveDetail(goldDoc.item.id, targetOpt.rootSessionId, targetOpt)
  assert.ok(goldDetail.item.relations.incoming.some(x => x.id === consumerDoc.item.id), 'X3 incoming backlink must list consumer')

  // Flip goldDoc to copper and verify affectedDependents warns consumerDoc
  const setCopperRes = mutateArchive({ op: 'setClip', id: goldDoc.item.id, paperclip: 'copper' }, targetOpt)
  assert.equal(setCopperRes.ok, true)
  assert.ok(
    setCopperRes.affectedDependents.some(d => d.id === consumerDoc.item.id),
    'X3 marking dossier as copper must return active affectedDependents',
  )

  // X1b: HTTP listArchiveHeaders with unspaced CJK query uses bilingual BM25
  const hdrHit = listArchiveHeaders(targetOpt.rootSessionId, { query: '高并发认证令牌刷新锁' }, targetOpt)
  assert.equal(hdrHit.ok, true)
  assert.ok(hdrHit.items.length >= 2, 'X1b listArchiveHeaders must recall unspaced Chinese BM25 query')

  // X3b: Deleting [[...]] wikilink from body removes stale ghost links completely
  const cleanedDoc = mutateArchive({
    op: 'save',
    id: consumerDoc.item.id,
    body: '已移除全部外部依赖。',
  }, targetOpt)
  assert.equal(cleanedDoc.ok, true)
  const cleanedDetail = getArchiveDetail(consumerDoc.item.id, targetOpt.rootSessionId, targetOpt)
  assert.deepEqual(cleanedDetail.item.links, [], 'X3b deleted wikilink must not remain as ghost link')
  assert.equal(cleanedDetail.item.relations.outgoing.length, 0, 'X3b outgoing relations must drop removed wikilink')
  assert.equal(cleanedDetail.item.relations.staleDependencies.length, 0, 'X3b staleDependencies must clear after link removal')

  console.log('[X1-X3 PASS] Bilingual BM25 (incl. headers), history[] rollback & WikiLink anti-ghost alerts verified')
}

async function runX4() {
  let sawGeminiHeaderKey = false
  let sawGeminiUrlKey = false
  let legacyFallbackMode = false

  const srv = http.createServer((req, res) => {
    let body = ''
    req.on('data', (c) => { body += c.toString('utf8') })
    req.on('end', () => {
      const parsed = body ? JSON.parse(body) : {}
      const url = req.url || ''
      if (url === '/v1/embeddings') {
        const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input]
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ data: inputs.map((_, index) => ({ index, embedding: [1, 0, 0, 0] })) }))
        return
      }
      if (url === '/api/embed') {
        if (legacyFallbackMode) {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ error: 'not found' }))
          return
        }
        const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input]
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ embeddings: inputs.map(() => [0, 1, 0, 0]) }))
        return
      }
      if (url === '/api/embeddings') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ embedding: [0, 0, 1, 0] }))
        return
      }
      if (url.includes(':embedContent')) {
        if (url.includes('key=')) sawGeminiUrlKey = true
        if (req.headers['x-goog-api-key'] === 'gemini-test-header-key') sawGeminiHeaderKey = true
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ embedding: { values: [0, 0, 0, 1] } }))
        return
      }
      res.writeHead(404)
      res.end()
    })
  })

  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve))
  const { port } = srv.address()
  const base = `http://127.0.0.1:${port}`

  try {
    // Config schema preserves provider
    const normCfg = normalizeExternalMemoryConfig({ embedding: { enabled: true, provider: 'gemini', baseUrl: base, model: 'gemini-embedding-001' } })
    assert.equal(normCfg.embedding.provider, 'gemini')

    // OpenAI
    const oaProbe = await probeEmbeddingApi({ provider: 'openai', baseUrl: `${base}/v1`, model: 'bge-m3' })
    assert.equal(oaProbe.ok, true)
    assert.equal(oaProbe.provider, 'openai')
    assert.equal(oaProbe.dimensions, 4)

    // Ollama modern /api/embed
    const olVecs = await fetchEmbeddingVectors({ provider: 'ollama', baseUrl: base, model: 'bge-m3' }, ['a', 'b'])
    assert.deepEqual(olVecs, [[0, 1, 0, 0], [0, 1, 0, 0]])

    // Ollama legacy 404 fallback /api/embeddings
    legacyFallbackMode = true
    const olLeg = await fetchEmbeddingVectors({ provider: 'ollama', baseUrl: base, model: 'bge-m3' }, ['fallback'])
    assert.deepEqual(olLeg, [[0, 0, 1, 0]])

    // Gemini :embedContent with x-goog-api-key header (never URL param)
    const gemProbe = await probeEmbeddingApi({
      provider: 'gemini',
      baseUrl: `${base}/v1beta`,
      model: 'gemini-embedding-001',
      apiKey: 'gemini-test-header-key',
    })
    assert.equal(gemProbe.ok, true)
    assert.equal(gemProbe.provider, 'gemini')
    assert.equal(gemProbe.dimensions, 4)
    assert.equal(sawGeminiHeaderKey, true, 'X4 Gemini API key must be sent in x-goog-api-key header')
    assert.equal(sawGeminiUrlKey, false, 'X4 Gemini API key must NEVER appear in URL')

    // X4b: URL auto-detection must not be locked by prior 'openai' default
    const autoOllama = normalizeExternalMemoryConfig(
      { embedding: { baseUrl: 'http://127.0.0.1:11434', model: 'bge-m3' } },
      { embedding: { provider: 'openai' } },
    )
    assert.equal(autoOllama.embedding.provider, 'ollama', 'X4b Ollama baseUrl must override stale openai default when omitted')

    const autoGemini = normalizeExternalMemoryConfig(
      { embedding: { baseUrl: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-embedding-001' } },
      { embedding: { provider: 'openai' } },
    )
    assert.equal(autoGemini.embedding.provider, 'gemini', 'X4b Gemini baseUrl must override stale openai default when omitted')

    // X4c: Friendly Ollama probe error message instead of bare 'fetch failed'
    const badOllama = await probeEmbeddingApi({ provider: 'ollama', baseUrl: 'http://127.0.0.1:1', model: 'bge-m3', timeoutMs: 1200 })
    assert.equal(badOllama.ok, false)
    assert.equal(badOllama.provider, 'ollama')
    assert.ok(badOllama.error.includes('Ollama'), 'X4c failed Ollama probe should return user-friendly Chinese hint')

    console.log('[X4 PASS] 3-protocol embedding client (OpenAI / Ollama+fallback / Gemini + auto-detect) verified')
  } finally {
    await new Promise(resolve => srv.close(resolve))
  }
}

try {
  runX1ToX3()
  await runX4()
  console.log('[dsh-chief cross-pollination gate] ALL X1-X4 PASSED')
} finally {
  fs.rmSync(tmpRoot, { recursive: true, force: true })
}
