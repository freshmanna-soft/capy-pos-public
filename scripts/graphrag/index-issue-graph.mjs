#!/usr/bin/env node
/**
 * Issue-graph indexer (issue #64): fetch capy-pos-public issues via gh, build the
 * :Issue subgraph (issue-graph.mjs), and upsert it into capy_kg (db.mjs).
 *
 * Usage: RAG_DB_URL=postgres://capy:<pw>@localhost:5433/capy_rag \
 *          node scripts/graphrag/index-issue-graph.mjs
 *   GH_REPO overrides the repo (default freshmanna-soft/capy-pos-public).
 */
import { execFileSync } from 'node:child_process';
import { buildIssueGraph } from './issue-graph.mjs';
import { makePool, upsertIssueGraph } from './db.mjs';

const REPO = process.env.GH_REPO || 'freshmanna-soft/capy-pos-public';

function fetchIssues() {
  const out = execFileSync(
    'gh',
    ['issue', 'list', '--repo', REPO, '--state', 'all', '--limit', '500', '--json', 'number,title,state,body'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return JSON.parse(out);
}

async function main() {
  const t0 = Date.now();
  const issues = fetchIssues();
  const graph = buildIssueGraph(issues);
  process.stdout.write(`fetched ${issues.length} issues → ${graph.nodes.length} nodes, ${graph.edges.length} edges\n`);

  const pool = makePool();
  try {
    const r = await upsertIssueGraph(pool, graph);
    process.stdout.write(
      `upserted into capy_kg: ${r.nodes} Issue nodes, ${r.edges} edges in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`index-issue-graph failed: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
