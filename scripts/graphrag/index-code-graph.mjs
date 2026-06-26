#!/usr/bin/env node
/**
 * Code-graph indexer (issue #63): parse the TS source into nodes/edges
 * (code-graph.mjs) and upsert them into the AGE `capy_kg` graph (db.mjs).
 *
 * Usage: RAG_DB_URL=postgres://capy:<pw>@localhost:5433/capy_rag \
 *          node scripts/graphrag/index-code-graph.mjs
 */
import { buildCodeGraph } from './code-graph.mjs';
import { makePool, upsertCodeGraph } from './db.mjs';

async function main() {
  const t0 = Date.now();
  const graph = buildCodeGraph(process.cwd());
  process.stdout.write(
    `parsed: ${graph.files.length} files, ${graph.symbols.length} symbols, ` +
      `${graph.layers.length} layers, ${graph.edges.length} edges\n`,
  );

  const pool = makePool();
  try {
    const r = await upsertCodeGraph(pool, graph);
    process.stdout.write(
      `upserted into capy_kg: ${r.nodes} nodes, ${r.edges} edges in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`index-code-graph failed: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
