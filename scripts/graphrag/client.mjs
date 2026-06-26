#!/usr/bin/env node
/**
 * GraphRAG client (issue #82) — the thin, universal way any consumer (cloud
 * `.claude` subagents, local Ollama `capy-*` agents, n8n) talks to the shared
 * retrieval endpoint (#81). Same surface for all three.
 *
 * Programmatic:
 *   import { graphRagQuery } from './client.mjs';
 *   const { hits } = await graphRagQuery('where is checkout total computed', { k: 5 });
 *
 * CLI:
 *   node scripts/graphrag/client.mjs "<query>" [--k 5]
 *   node scripts/graphrag/client.mjs --file <relpath>
 *   node scripts/graphrag/client.mjs --epic <n>
 *
 *   GRAPHRAG_ENDPOINT overrides the base URL (default http://localhost:37777).
 */
const DEFAULT_ENDPOINT = process.env.GRAPHRAG_ENDPOINT || 'http://localhost:37777';

async function getJson(url, init) {
  const res = await fetch(url, init);
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`GraphRAG ${res.status}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

/** Semantic + graph retrieval: top-k hits each enriched with graph neighborhood. */
export function graphRagQuery(query, { k = 5, endpoint = DEFAULT_ENDPOINT } = {}) {
  return getJson(`${endpoint}/search`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, k }),
  });
}

/** Graph neighborhood of a code file (by repo-relative path). */
export function fileNeighbors(path, { endpoint = DEFAULT_ENDPOINT } = {}) {
  return getJson(`${endpoint}/file?path=${encodeURIComponent(path)}`);
}

/** Stories of an epic by issue number. */
export function epicStories(number, { endpoint = DEFAULT_ENDPOINT } = {}) {
  return getJson(`${endpoint}/epic?number=${encodeURIComponent(number)}`);
}

function isMain() {
  return process.argv[1] && process.argv[1].endsWith('client.mjs');
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const fileIdx = argv.indexOf('--file');
  const epicIdx = argv.indexOf('--epic');
  const kIdx = argv.indexOf('--k');
  const run = async () => {
    if (fileIdx >= 0) return fileNeighbors(argv[fileIdx + 1]);
    if (epicIdx >= 0) return epicStories(argv[epicIdx + 1]);
    const k = kIdx >= 0 ? Number(argv[kIdx + 1]) : 5;
    const query = argv.filter((a, i) => !a.startsWith('--') && i !== kIdx + 1).join(' ');
    return graphRagQuery(query, { k });
  };
  run()
    .then((out) => process.stdout.write(JSON.stringify(out, null, 2) + '\n'))
    .catch((err) => {
      process.stderr.write(`graphrag client failed: ${err?.message ?? err}\n`);
      process.exitCode = 1;
    });
}
