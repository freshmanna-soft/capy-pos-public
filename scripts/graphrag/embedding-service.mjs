#!/usr/bin/env node
/**
 * GraphRAG embedding service (issue #57).
 *
 * Turns text into vectors via a LOCAL Ollama model (`nomic-embed-text` by default,
 * 768-dim) so content can be embedded cheaply for the shared vector store (#56).
 *
 * Design rules (from the local-agents convention — see memory `ollama-agents-invocation`):
 *   - Talk to Ollama over its HTTP API, never `ollama run`.
 *   - SERIALIZE model calls: only one embed request is in flight at a time, so
 *     concurrent callers queue instead of hammering the model in parallel.
 *
 * Failure policy: on any error the service THROWS an EmbeddingError and never
 * returns a partial/garbage vector — callers must not write anything on throw, so
 * the store can't be corrupted by a bad embedding. Network/timeout/5xx are flagged
 * `retryable`; client/config errors (bad model, dimension mismatch) are not.
 *
 * Env:
 *   OLLAMA_URL        default http://localhost:11434
 *   EMBED_MODEL       default nomic-embed-text
 *   EMBED_DIM         default 768   (must match the rag_embeddings.embedding column)
 *   EMBED_TIMEOUT_MS  default 30000
 */

export const OLLAMA_URL = process.env.OLLAMA_URL ?? 'http://localhost:11434';
export const EMBED_MODEL = process.env.EMBED_MODEL ?? 'nomic-embed-text';
export const EMBED_DIM = Number(process.env.EMBED_DIM ?? 768);
const TIMEOUT_MS = Number(process.env.EMBED_TIMEOUT_MS ?? 30_000);

export class EmbeddingError extends Error {
  /** @param {string} message @param {{retryable?: boolean, cause?: unknown}} [opts] */
  constructor(message, { retryable = false, cause } = {}) {
    super(message);
    this.name = 'EmbeddingError';
    this.retryable = retryable;
    if (cause !== undefined) this.cause = cause;
  }
}

// --- serialization: one Ollama call at a time ----------------------------------
// Each enqueued task runs only after the previous one has settled. The chain
// itself swallows errors so a single failure doesn't wedge the queue, while the
// original caller still receives the real result/rejection.
let tail = Promise.resolve();
function enqueue(task) {
  const result = tail.then(() => task());
  tail = result.then(
    () => undefined,
    () => undefined,
  );
  return result;
}

/**
 * Embed a single chunk of text. Serialized against all other embed/embedBatch calls.
 * @param {string} text
 * @returns {Promise<number[]>} a vector of length EMBED_DIM
 */
export function embed(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return Promise.reject(new EmbeddingError('embed() requires a non-empty string'));
  }
  return enqueue(() => embedNow(text));
}

/**
 * Embed many chunks, one model call at a time (still fully serialized).
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export function embedBatch(texts) {
  if (!Array.isArray(texts)) {
    return Promise.reject(new EmbeddingError('embedBatch() requires an array of strings'));
  }
  // Each embed() enqueues independently, so they run in submission order, serialized.
  return Promise.all(texts.map((t) => embed(t)));
}

async function embedNow(text) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${OLLAMA_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
      signal: controller.signal,
    });
  } catch (cause) {
    const aborted = cause?.name === 'AbortError';
    throw new EmbeddingError(
      aborted
        ? `Ollama embed timed out after ${TIMEOUT_MS}ms`
        : `Ollama not reachable at ${OLLAMA_URL} (is it running?)`,
      { retryable: true, cause },
    );
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new EmbeddingError(
      `Ollama embed failed: HTTP ${res.status}${body ? ` — ${body.slice(0, 200)}` : ''}`,
      // 5xx is transient and worth retrying; 4xx (bad model/request) is not.
      { retryable: res.status >= 500 },
    );
  }

  let payload;
  try {
    payload = await res.json();
  } catch (cause) {
    throw new EmbeddingError('Ollama returned a non-JSON embed response', { retryable: true, cause });
  }

  const vector = payload?.embedding;
  if (!Array.isArray(vector) || vector.length === 0) {
    throw new EmbeddingError('Ollama embed response had no "embedding" array', { retryable: true });
  }
  if (vector.length !== EMBED_DIM) {
    // Wrong model or misconfigured dimension — refuse rather than write a row the
    // vector(EMBED_DIM) column would reject (or, worse, silently mismatch).
    throw new EmbeddingError(
      `Embedding dimension ${vector.length} != expected ${EMBED_DIM} (model "${EMBED_MODEL}")`,
      { retryable: false },
    );
  }
  return vector;
}
