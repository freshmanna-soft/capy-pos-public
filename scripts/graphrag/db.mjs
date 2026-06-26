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
