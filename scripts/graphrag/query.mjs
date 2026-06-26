#!/usr/bin/env node
/**
 * Top-k semantic query interface (issue #59) — the callable retrieval surface
 * that Phase 4 consumers (cloud subagents / local Ollama agents / n8n) will hit.
 *
 * Embeds the query with the #57 service, then ranks stored chunks (#56/#58) by
 * cosine similarity using pgvector's `<=>` operator (cosine distance). Similarity
 * is reported as `1 - distance` (1.0 = identical direction).
 *
 * Programmatic:
 *   import { search } from './query.mjs';
 *   const hits = await search('where is checkout total computed?', { k: 5 });
 *
 * CLI:
 *   RAG_DB_URL=... node scripts/graphrag/query.mjs "natural language query" [--k 5] [--type code]
 */
import { embed } from './embedding-service.mjs';
import { makePool, toVector } from './db.mjs';

/**
 * @param {string} query
 * @param {{k?: number, sourceType?: string, pool?: import('pg').Pool, embedFn?: (t:string)=>Promise<number[]>}} [opts]
 * @returns {Promise<{sourceId:string, path:string|null, startLine:number|null, endLine:number|null, score:number, chunk:string}[]>}
 */
export async function search(query, opts = {}) {
  if (typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('search() requires a non-empty query string');
  }
  const k = Number.isFinite(opts.k) && opts.k > 0 ? Math.floor(opts.k) : 5;
  const sourceType = opts.sourceType ?? 'code';
  const embedFn = opts.embedFn ?? embed;

  const pool = opts.pool ?? makePool();
  const ownsPool = !opts.pool;

  try {
    const vector = toVector(await embedFn(query));
    const { rows } = await pool.query(
      `SELECT source_id,
              chunk,
              metadata,
              1 - (embedding <=> $1::vector) AS score
         FROM rag_embeddings
        WHERE source_type = $2
        ORDER BY embedding <=> $1::vector
        LIMIT $3`,
      [vector, sourceType, k],
    );
    return rows.map((r) => ({
      sourceId: r.source_id,
      path: r.metadata?.path ?? null,
      startLine: r.metadata?.start_line ?? null,
      endLine: r.metadata?.end_line ?? null,
      score: Number(r.score),
      chunk: r.chunk,
    }));
  } finally {
    if (ownsPool) await pool.end();
  }
}

// --- CLI ----------------------------------------------------------------------
function isMain() {
  return process.argv[1] && process.argv[1].endsWith('query.mjs');
}

if (isMain()) {
  const argv = process.argv.slice(2);
  let k = 5;
  let sourceType = 'code';
  const terms = [];
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--k') k = Number(argv[(i += 1)]);
    else if (argv[i] === '--type') sourceType = argv[(i += 1)];
    else terms.push(argv[i]);
  }
  const query = terms.join(' ');
  search(query, { k, sourceType })
    .then((hits) => {
      if (hits.length === 0) {
        process.stdout.write('(no results)\n');
        return;
      }
      for (const h of hits) {
        process.stdout.write(`\n[${h.score.toFixed(4)}] ${h.sourceId}\n`);
        process.stdout.write(`${h.chunk.split('\n').slice(0, 4).join('\n')}\n`);
      }
    })
    .catch((err) => {
      process.stderr.write(`query failed: ${err?.message ?? err}\n`);
      process.exitCode = 1;
    });
}
