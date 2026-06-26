#!/usr/bin/env node
/**
 * Graph traversal + vector↔graph hop (issue #66) — completes GraphRAG.
 *
 * Pairs the Phase 1 vector surface (query.mjs `search()`) with AGE graph
 * traversal over capy_kg. Both are keyed on the same canonical id (a File node's
 * id equals the `path` portion of a `rag_embeddings.source_id`), so a semantic
 * hit can hop straight to its graph neighborhood.
 *
 * Programmatic:
 *   import { graphRagSearch, fileNeighborhood, dependents, epicStories } from './graph-query.mjs';
 *
 * CLI:
 *   RAG_DB_URL=… node scripts/graphrag/graph-query.mjs "<natural language query>" [--k 5]
 *   RAG_DB_URL=… node scripts/graphrag/graph-query.mjs --file <path>
 *   RAG_DB_URL=… node scripts/graphrag/graph-query.mjs --epic <issue-number>
 */
import { makePool } from './db.mjs';
import { search } from './query.mjs';

const GRAPH = 'capy_kg';

/** Parse an AGE agtype scalar (JSON-ish) into a JS value. */
export function parseAgtype(v) {
  if (v === null || v === undefined) return null;
  try {
    return JSON.parse(v);
  } catch {
    return v;
  }
}

function esc(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/**
 * Run a read-only Cypher query against capy_kg on a single session (AGE must be
 * loaded + on the search_path per connection). Returns rows as arrays of parsed
 * agtype scalars, one per RETURN column.
 */
export async function graphRead(pool, cypher, ncols = 1) {
  const client = await pool.connect();
  try {
    await client.query("LOAD 'age'");
    await client.query('SET search_path = ag_catalog, "$user", public');
    const cols = Array.from({ length: ncols }, (_, i) => `c${i} agtype`).join(', ');
    const res = await client.query(`SELECT * FROM cypher('${GRAPH}', $$ ${cypher} $$) AS (${cols})`);
    return res.rows.map((row) => Object.values(row).map(parseAgtype));
  } finally {
    client.release();
  }
}

/** Graph neighborhood of a code file (the vector→graph hop target). */
export async function fileNeighborhood(pool, path) {
  const p = esc(path);
  const [layer, imports, importedBy, symbols] = await Promise.all([
    graphRead(pool, `MATCH (:File {id:'${p}'})-[:IN_LAYER]->(l:Layer) RETURN l.name`, 1),
    graphRead(pool, `MATCH (:File {id:'${p}'})-[:IMPORTS]->(t:File) RETURN t.id`, 1),
    graphRead(pool, `MATCH (s:File)-[:IMPORTS]->(:File {id:'${p}'}) RETURN s.id`, 1),
    graphRead(pool, `MATCH (sym:Symbol)-[:DEFINED_IN]->(:File {id:'${p}'}) RETURN sym.name, sym.kind`, 2),
  ]);
  return {
    path,
    layer: layer[0]?.[0] ?? null,
    imports: imports.map((r) => r[0]),
    importedBy: importedBy.map((r) => r[0]),
    symbols: symbols.map((r) => ({ name: r[0], kind: r[1] })),
  };
}

/** "What depends on X" — symbols that DEPENDS_ON the named symbol. */
export async function dependents(pool, symbolName) {
  const rows = await graphRead(
    pool,
    `MATCH (d:Symbol)-[:DEPENDS_ON]->(t:Symbol {name:'${esc(symbolName)}'}) RETURN d.name, d.kind, d.path`,
    3,
  );
  return rows.map((r) => ({ name: r[0], kind: r[1], path: r[2] }));
}

/** "Stories of epic Y" — issues PART_OF the given epic number. */
export async function epicStories(pool, epicNumber) {
  const rows = await graphRead(
    pool,
    `MATCH (s:Issue)-[:PART_OF]->(:Issue {id:'${esc(String(epicNumber))}'}) RETURN s.number, s.title, s.state`,
    3,
  );
  return rows.map((r) => ({ number: r[0], title: r[1], state: r[2] }));
}

/**
 * GraphRAG search: semantic top-k (vector) + each hit's graph neighborhood.
 * @param {string} query
 * @param {{k?: number, pool?: import('pg').Pool}} [opts]
 */
export async function graphRagSearch(query, opts = {}) {
  const pool = opts.pool ?? makePool();
  const ownsPool = !opts.pool;
  try {
    const hits = await search(query, { k: opts.k ?? 5, pool });
    const enriched = [];
    for (const hit of hits) {
      enriched.push({ ...hit, graph: hit.path ? await fileNeighborhood(pool, hit.path) : null });
    }
    return enriched;
  } finally {
    if (ownsPool) await pool.end();
  }
}

// --- CLI ----------------------------------------------------------------------
function isMain() {
  return process.argv[1] && process.argv[1].endsWith('graph-query.mjs');
}

if (isMain()) {
  const argv = process.argv.slice(2);
  const run = async () => {
    const pool = makePool();
    try {
      const fileIdx = argv.indexOf('--file');
      const epicIdx = argv.indexOf('--epic');
      if (fileIdx >= 0) {
        const n = await fileNeighborhood(pool, argv[fileIdx + 1]);
        process.stdout.write(JSON.stringify(n, null, 2) + '\n');
      } else if (epicIdx >= 0) {
        const s = await epicStories(pool, argv[epicIdx + 1]);
        process.stdout.write(JSON.stringify(s, null, 2) + '\n');
      } else {
        const kIdx = argv.indexOf('--k');
        const k = kIdx >= 0 ? Number(argv[kIdx + 1]) : 5;
        const query = argv.filter((a, i) => !a.startsWith('--') && i !== kIdx + 1).join(' ');
        const hits = await graphRagSearch(query, { k, pool });
        for (const h of hits) {
          process.stdout.write(`\n[${h.score.toFixed(4)}] ${h.sourceId}  (layer: ${h.graph?.layer ?? '—'})\n`);
          if (h.graph) {
            process.stdout.write(`  imports: ${h.graph.imports.length} · importedBy: ${h.graph.importedBy.length} · symbols: ${h.graph.symbols.map((s) => s.name).join(', ') || '—'}\n`);
          }
        }
      }
    } finally {
      await pool.end();
    }
  };
  run().catch((err) => {
    process.stderr.write(`graph-query failed: ${err?.message ?? err}\n`);
    process.exitCode = 1;
  });
}
