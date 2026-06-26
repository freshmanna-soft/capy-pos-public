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
import { makePool } from './db.mjs';
import { graphRagSearch, fileNeighborhood, epicStories } from './graph-query.mjs';

const PORT = Number(process.env.GRAPHRAG_PORT || 37777);

/** Validate/normalize a /search body. Throws on bad input. */
export function validateSearch(body) {
  if (!body || typeof body.query !== 'string' || body.query.trim() === '') {
    throw new Error('`query` (non-empty string) is required');
  }
  const k = Number.isFinite(body.k) && body.k > 0 ? Math.floor(body.k) : 5;
  return { query: body.query, k };
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
