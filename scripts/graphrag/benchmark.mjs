#!/usr/bin/env node
/**
 * GraphRAG payoff benchmark (issue #83) — closes the epic's acceptance criterion
 * ("demonstrated reduction in tokens-per-task").
 *
 * For each representative "find the code for X" task it compares the context an
 * agent must ingest:
 *   - Baseline (no retrieval): read the WHOLE files that hold the answer.
 *   - GraphRAG: just the top-k relevant chunks returned by graphRagSearch.
 * Same files identified — GraphRAG returns the relevant slices instead of whole
 * files. Tokens are estimated at ~4 chars/token (labelled as an estimate).
 *
 * Usage: RAG_DB_URL=… node scripts/graphrag/benchmark.mjs
 */
import { readFileSync } from 'node:fs';
import { makePool } from './db.mjs';
import { graphRagSearch } from './graph-query.mjs';

/** Rough token estimate (~4 chars/token). */
export function estimateTokens(text) {
  return Math.ceil((text ?? '').length / 4);
}

const TASKS = [
  'where is the checkout total calculated',
  'offline sync engine that pushes changes to the server',
  'how are customers created and validated',
  'product repository that fetches products',
  'low stock alert threshold configuration',
  'publish and subscribe to domain events on the event bus',
];

async function main() {
  const pool = makePool();
  let totG = 0;
  let totB = 0;
  let totMs = 0;
  const rows = [];
  try {
    for (const q of TASKS) {
      const t0 = Date.now();
      const hits = await graphRagSearch(q, { k: 5, pool });
      const ms = Date.now() - t0;
      totMs += ms;

      const graphragTokens = hits.reduce((a, h) => a + estimateTokens(h.chunk), 0);
      const files = [...new Set(hits.map((h) => h.path).filter(Boolean))];
      let baselineTokens = 0;
      for (const f of files) {
        try {
          baselineTokens += estimateTokens(readFileSync(f, 'utf8'));
        } catch {
          /* file not on disk (e.g. moved) — skip */
        }
      }
      totG += graphragTokens;
      totB += baselineTokens;
      const pct = baselineTokens ? Math.round((1 - graphragTokens / baselineTokens) * 100) : 0;
      rows.push({ q, files: files.length, graphragTokens, baselineTokens, pct, ms });
    }
  } finally {
    await pool.end();
  }

  process.stdout.write('\n| task | files | GraphRAG tok | baseline tok | reduction | retr ms |\n');
  process.stdout.write('|---|---|---|---|---|---|\n');
  for (const r of rows) {
    process.stdout.write(`| ${r.q.slice(0, 46)} | ${r.files} | ${r.graphragTokens} | ${r.baselineTokens} | ${r.pct}% | ${r.ms} |\n`);
  }
  const overall = totB ? Math.round((1 - totG / totB) * 100) : 0;
  process.stdout.write(
    `\nTOTAL: GraphRAG ${totG} tok vs baseline ${totB} tok → ${overall}% fewer tokens ` +
      `(est. ~4 chars/tok); avg retrieval ${Math.round(totMs / TASKS.length)}ms\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`benchmark failed: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
