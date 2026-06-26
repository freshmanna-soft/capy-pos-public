/**
 * Postgres access for the GraphRAG vector store (issue #58).
 * Connects to the capy-rag-db service from #56 and upserts code chunks.
 */
import pg from 'pg';

const { Pool } = pg;

/** Default points at the dedicated capy-rag-db published on host 5433 (see #56). */
export function makePool(connectionString = process.env.RAG_DB_URL) {
  if (!connectionString) {
    throw new Error('RAG_DB_URL is not set (e.g. postgres://capy:<pw>@localhost:5433/capy_rag)');
  }
  return new Pool({ connectionString });
}

/** pgvector accepts the textual form '[v1,v2,...]'. */
export function toVector(arr) {
  return `[${arr.join(',')}]`;
}

/**
 * Replace ALL stored chunks for one file atomically: delete the file's existing
 * rows, then insert the current chunks. This makes re-indexing idempotent and —
 * unlike a pure per-chunk upsert — leaves no orphan rows when chunk boundaries
 * shift after an edit. Runs in a single transaction.
 *
 * @param {pg.Pool} pool
 * @param {{path: string, lang: string, rows: {sourceId: string, startLine: number, endLine: number, text: string, embedding: number[]}[]}} file
 * @returns {Promise<number>} rows written
 */
export async function upsertFileChunks(pool, { path, lang, rows }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `DELETE FROM rag_embeddings WHERE source_type = 'code' AND metadata->>'path' = $1`,
      [path],
    );
    for (const r of rows) {
      await client.query(
        `INSERT INTO rag_embeddings (source_type, source_id, chunk, embedding, metadata)
         VALUES ('code', $1, $2, $3::vector, $4)
         ON CONFLICT (source_type, source_id) DO UPDATE
           SET chunk = EXCLUDED.chunk,
               embedding = EXCLUDED.embedding,
               metadata = EXCLUDED.metadata,
               updated_at = now()`,
        [
          r.sourceId,
          r.text,
          toVector(r.embedding),
          JSON.stringify({ path, lang, start_line: r.startLine, end_line: r.endLine }),
        ],
      );
    }
    await client.query('COMMIT');
    return rows.length;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// --- Apache AGE graph (capy_kg) ------------------------------------------------

const GRAPH = 'capy_kg';

/** Escape a value for use inside a single-quoted Cypher string literal. */
function escCypher(v) {
  return String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

/** A Cypher node-match pattern: Layer matches by `name`, everything else by `id`. */
function matchRef(varName, label, idVal) {
  const key = label === 'Layer' ? 'name' : 'id';
  return `(${varName}:${label} {${key}: '${escCypher(idVal)}'})`;
}

/** Wrap a Cypher statement as an AGE SQL call. */
function cypherStmt(cypher) {
  return `SELECT * FROM cypher('${GRAPH}', $$ ${cypher} $$) AS (v agtype);`;
}

/**
 * Run Cypher statements against capy_kg. AGE must be loaded and on the search_path
 * per connection, so every batch is prefixed with LOAD + SET. Statements run in
 * order; batched to keep query strings reasonable.
 * @param {pg.Pool} pool
 * @param {string[]} statements  full SQL statements (e.g. from cypherStmt)
 */
export async function graphExec(pool, statements, batchSize = 150) {
  const preamble = `LOAD 'age'; SET search_path = ag_catalog, "$user", public;`;
  for (let i = 0; i < statements.length; i += batchSize) {
    const batch = statements.slice(i, i + batchSize).join('\n');
    await pool.query(`${preamble}\n${batch}`);
  }
}

/**
 * Replace the code subgraph (File/Symbol/Layer + their edges) in capy_kg.
 * Scope-clears only those labels so future :Issue / :Memory subgraphs survive,
 * then MERGEs nodes and edges (idempotent — re-running yields identical counts).
 * @param {pg.Pool} pool
 * @param {{files: object[], symbols: object[], layers: string[], edges: object[]}} graph
 */
export async function upsertCodeGraph(pool, { files, symbols, layers, edges }) {
  const stmts = [];

  // 1. Scope-clear the code labels.
  for (const label of ['File', 'Symbol', 'Layer']) {
    stmts.push(cypherStmt(`MATCH (n:${label}) DETACH DELETE n`));
  }

  // 2. Nodes (layers, files, symbols) — must exist before edges.
  for (const name of layers) {
    stmts.push(cypherStmt(`MERGE (n:Layer {name: '${escCypher(name)}'})`));
  }
  for (const f of files) {
    stmts.push(
      cypherStmt(
        `MERGE (n:File {id: '${escCypher(f.id)}'}) SET n.layer = '${escCypher(f.layer)}', n.lang = '${escCypher(f.lang)}'`,
      ),
    );
  }
  for (const s of symbols) {
    stmts.push(
      cypherStmt(
        `MERGE (n:Symbol {id: '${escCypher(s.id)}'}) SET n.name = '${escCypher(s.name)}', n.kind = '${escCypher(s.kind)}', n.path = '${escCypher(s.path)}', n.layer = '${escCypher(s.layer)}'`,
      ),
    );
  }

  // 3. Edges.
  for (const e of edges) {
    const a = matchRef('a', e.from.label, e.from.id);
    const b = matchRef('b', e.to.label, e.to.id);
    stmts.push(cypherStmt(`MATCH ${a}, ${b} MERGE (a)-[:${e.type}]->(b)`));
  }

  await graphExec(pool, stmts);
  return { nodes: layers.length + files.length + symbols.length, edges: edges.length };
}
