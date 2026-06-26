#!/usr/bin/env node
/**
 * Memory-graph indexer (issue #65): read the claude-mem memory files, build the
 * :Memory link subgraph (memory-graph.mjs), and upsert into capy_kg (db.mjs).
 *
 * Usage: RAG_DB_URL=postgres://capy:<pw>@localhost:5433/capy_rag \
 *          node scripts/graphrag/index-memory-graph.mjs
 *   MEMORY_DIR overrides the memory directory. Default follows the claude-mem
 *   convention: ~/.claude/projects/<cwd-with-slashes-as-dashes>/memory.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { buildMemoryGraph } from './memory-graph.mjs';
import { makePool, upsertMemoryGraph } from './db.mjs';

function defaultMemoryDir() {
  // claude-mem encodes the project path by replacing '/' with '-'.
  const encoded = process.cwd().split('/').join('-');
  return join(homedir(), '.claude', 'projects', encoded, 'memory');
}

function parseMemo(content) {
  const name = content.match(/^name:\s*(\S+)/m)?.[1];
  const type = content.match(/^\s*type:\s*(\S+)/m)?.[1] ?? '';
  return { name, type, body: content };
}

function readMemos(dir) {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && f !== 'MEMORY.md')
    .map((f) => parseMemo(readFileSync(join(dir, f), 'utf8')))
    .filter((m) => m.name); // skip files without a name slug
}

async function main() {
  const t0 = Date.now();
  const dir = process.env.MEMORY_DIR || defaultMemoryDir();
  const memos = readMemos(dir);
  const graph = buildMemoryGraph(memos);
  const dangling = graph.edges.filter((e) => e.dangling).length;
  process.stdout.write(
    `read ${memos.length} memories from ${dir} → ${graph.nodes.length} nodes, ` +
      `${graph.edges.length} links (${dangling} dangling)\n`,
  );

  const pool = makePool();
  try {
    const r = await upsertMemoryGraph(pool, graph);
    process.stdout.write(
      `upserted into capy_kg: ${r.nodes} Memory nodes, ${r.edges} links in ${((Date.now() - t0) / 1000).toFixed(1)}s\n`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`index-memory-graph failed: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
