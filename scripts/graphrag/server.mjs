#!/usr/bin/env node
/**
 * GraphRAG HTTP retrieval endpoint (issue #81) — one shared surface that the
 * cloud subagents, local Ollama agents, and n8n (#82) all hit. Thin, dependency-
 * free wrapper (Node http) over graph-query.mjs / query.mjs.
 *
 * Routes:
 *   GET  /health                         → { ok: true }
 *   POST /search   { query, k? }         → { query, hits[] }  (semantic + graph neighborhood)
 *   GET  /file?path=<relpath>            → file graph neighborhood
 *   GET  /epic?number=<n>                → { epic, stories[] }
 *
 * Usage: RAG_DB_URL=… GRAPHRAG_PORT=37777 node scripts/graphrag/server.mjs
 */
import http from 'node:http';
import { spawn } from 'node:child_process';
import { makePool, upsertEmbedding } from './db.mjs';
import { graphRagSearch, fileNeighborhood, epicStories } from './graph-query.mjs';
import { search } from './query.mjs';
import { embed } from './embedding-service.mjs';

const PORT = Number(process.env.GRAPHRAG_PORT || 37777);

/**
 * Authorize a /reindex webhook call (#99). Returns 'ok' | 'disabled' | 'unauthorized'.
 * Disabled unless GRAPHRAG_WEBHOOK_SECRET is set — the trigger is opt-in.
 */
export function authorizeReindex(headers, secret = process.env.GRAPHRAG_WEBHOOK_SECRET) {
  if (!secret) return 'disabled';
  return headers['x-webhook-secret'] === secret ? 'ok' : 'unauthorized';
}

/** Validate/normalize a /search body. Throws on bad input. */
export function validateSearch(body) {
  if (!body || typeof body.query !== 'string' || body.query.trim() === '') {
    throw new Error('`query` (non-empty string) is required');
  }
  const k = Number.isFinite(body.k) && body.k > 0 ? Math.floor(body.k) : 5;
  return { query: body.query, k };
}

/** Validate/normalize an /ingest body. Throws on bad input. */
export function validateIngest(body) {
  const need = (v, n) => {
    if (typeof v !== 'string' || v.trim() === '') throw new Error(`\`${n}\` (non-empty string) is required`);
  };
  if (!body || typeof body !== 'object') throw new Error('a JSON object body is required');
  need(body.sourceType, 'sourceType');
  need(body.sourceId, 'sourceId');
  need(body.text, 'text');
  const metadata = body.metadata && typeof body.metadata === 'object' ? body.metadata : {};
  return { sourceType: body.sourceType, sourceId: body.sourceId, text: body.text, metadata };
}

function send(res, code, obj) {
  const b = JSON.stringify(obj);
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(b);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => {
      data += c;
      if (data.length > 1_000_000) reject(new Error('body too large'));
    });
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

export function createServer(pool) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (req.method === 'GET' && url.pathname === '/health') {
        return send(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/search') {
        const { query, k } = validateSearch(await readJson(req));
        const hits = await graphRagSearch(query, { k, pool });
        return send(res, 200, { query, k, hits });
      }
      if (req.method === 'GET' && url.pathname === '/file') {
        const path = url.searchParams.get('path');
        if (!path) return send(res, 400, { error: '`path` query param is required' });
        return send(res, 200, await fileNeighborhood(pool, path));
      }
      if (req.method === 'GET' && url.pathname === '/epic') {
        const number = url.searchParams.get('number');
        if (!number) return send(res, 400, { error: '`number` query param is required' });
        return send(res, 200, { epic: Number(number), stories: await epicStories(pool, number) });
      }
      if (req.method === 'POST' && url.pathname === '/ingest') {
        // Write a single embedding row of any source_type (e.g. build memories).
        //
        // Same opt-in auth as /reindex: when GRAPHRAG_WEBHOOK_SECRET is set it is
        // enforced, and when it is unset the write is accepted unauthenticated.
        // Note that `server.listen(PORT)` below passes no host, so this binds every
        // interface rather than loopback despite the startup log saying localhost —
        // meaning with no secret configured this is a write path open to anyone on
        // the network. Set the secret. (Tightening the bind is not a free fix: a
        // containerised caller reaches the host via host.docker.internal, which is
        // not loopback.)
        const auth = authorizeReindex(req.headers);
        if (auth === 'unauthorized') return send(res, 401, { error: 'invalid x-webhook-secret' });
        const { sourceType, sourceId, text, metadata } = validateIngest(await readJson(req));
        const embedding = await embed(text);
        await upsertEmbedding(pool, { sourceType, sourceId, text, embedding, metadata });
        return send(res, 200, { ok: true, sourceType, sourceId });
      }
      if (req.method === 'POST' && url.pathname === '/recall') {
        // Semantic recall over a NON-code source_type (default build memories),
        // leaving the code-only /search contract untouched.
        const body = await readJson(req);
        const { query, k } = validateSearch(body);
        const sourceType = typeof body.sourceType === 'string' && body.sourceType.trim() ? body.sourceType : 'build_memory';
        const hits = await search(query, { k, sourceType, pool });
        return send(res, 200, { query, k, sourceType, hits });
      }
      if (req.method === 'POST' && url.pathname === '/reindex') {
        const auth = authorizeReindex(req.headers);
        if (auth === 'disabled') return send(res, 503, { error: 'reindex webhook disabled (set GRAPHRAG_WEBHOOK_SECRET)' });
        if (auth === 'unauthorized') return send(res, 401, { error: 'invalid x-webhook-secret' });
        // Fire-and-forget incremental reindex; respond immediately.
        spawn('node', ['scripts/graphrag/reindex-all.mjs', '--incremental'], {
          detached: true,
          stdio: 'ignore',
          env: process.env,
        }).unref();
        return send(res, 202, { triggered: true, mode: 'incremental' });
      }
      return send(res, 404, { error: 'not found' });
    } catch (err) {
      const msg = err?.message ?? String(err);
      return send(res, /required|invalid|too large/.test(msg) ? 400 : 500, { error: msg });
    }
  });
}

function isMain() {
  return process.argv[1] && process.argv[1].endsWith('server.mjs');
}

if (isMain()) {
  const pool = makePool();
  const server = createServer(pool);
  server.listen(PORT, () => process.stdout.write(`graphrag retrieval endpoint on http://localhost:${PORT}\n`));
  for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => server.close(() => pool.end().then(() => process.exit(0))));
  }
}
