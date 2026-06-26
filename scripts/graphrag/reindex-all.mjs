#!/usr/bin/env node
/**
 * GraphRAG reindex orchestrator (issue #78) — refresh the whole store in one
 * command. Runs the vector + graph indexers in sequence (each idempotent), so
 * the store reflects the current repo/issues/memory.
 *
 * Usage: RAG_DB_URL=postgres://capy:<pw>@localhost:5433/capy_rag \
 *          node scripts/graphrag/reindex-all.mjs
 *
 * Steps that need external services degrade gracefully:
 *   - vector embedding needs Ollama (nomic-embed-text)
 *   - issue graph needs `gh`
 * A failing step is reported but does not abort the rest unless --strict is set.
 */
import { execFileSync } from 'node:child_process';

const STRICT = process.argv.includes('--strict');
// --incremental re-embeds only changed files for the vector corpus (the ~40s
// cost); graphs rebuild wholesale (cheap) so cross-file edges stay correct.
const INCREMENTAL = process.argv.includes('--incremental');

const STEPS = [
  ['Vector — codebase corpus', 'index-codebase.mjs', INCREMENTAL ? ['--incremental'] : []],
  ['Graph — code structure', 'index-code-graph.mjs', []],
  ['Graph — GitHub issues', 'index-issue-graph.mjs', []],
  ['Graph — memory links', 'index-memory-graph.mjs', []],
];

const t0 = Date.now();
let failures = 0;

for (const [label, script, extraArgs] of STEPS) {
  process.stdout.write(`\n=== ${label} (${script}${extraArgs.length ? ` ${extraArgs.join(' ')}` : ''}) ===\n`);
  try {
    execFileSync('node', [`scripts/graphrag/${script}`, ...extraArgs], { stdio: 'inherit', env: process.env });
  } catch (err) {
    failures += 1;
    process.stderr.write(`  ✗ ${script} failed: ${err?.message ?? err}\n`);
    if (STRICT) {
      process.stderr.write('  (--strict) aborting.\n');
      process.exitCode = 1;
      break;
    }
  }
}

const secs = ((Date.now() - t0) / 1000).toFixed(1);
process.stdout.write(`\nreindex-all: ${STEPS.length - failures}/${STEPS.length} steps OK in ${secs}s\n`);
if (failures > 0 && process.exitCode === undefined) process.exitCode = STRICT ? 1 : 0;
