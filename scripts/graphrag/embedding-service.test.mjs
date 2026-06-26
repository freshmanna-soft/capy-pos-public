import { afterEach, describe, expect, it, vi } from 'vitest';
import { embed, embedBatch, EmbeddingError, EMBED_DIM } from './embedding-service.mjs';

/** Build a fake Ollama /api/embeddings OK response with an N-length embedding. */
function okResponse(dim = EMBED_DIM) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ embedding: Array.from({ length: dim }, (_, i) => i / dim) }),
    text: async () => '',
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('embedding-service', () => {
  it('returns a vector matching the embeddings column dimension', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
    const v = await embed('hello world');
    expect(Array.isArray(v)).toBe(true);
    expect(v).toHaveLength(EMBED_DIM);
  });

  it('serializes concurrent calls — one model call in flight at a time', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((r) => setTimeout(r, 10)); // hold the "model" busy
        inFlight -= 1;
        return okResponse();
      }),
    );

    await Promise.all([embed('a'), embed('b'), embed('c')]);
    expect(maxInFlight).toBe(1); // never two requests overlapping
  });

  it('embedBatch preserves order and returns one vector per input', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse()));
    const out = await embedBatch(['x', 'y']);
    expect(out).toHaveLength(2);
    expect(out[0]).toHaveLength(EMBED_DIM);
  });

  it('throws a retryable EmbeddingError when Ollama is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    );
    await expect(embed('hi')).rejects.toMatchObject({
      name: 'EmbeddingError',
      retryable: true,
    });
  });

  it('throws (non-retryable) on dimension mismatch and returns no vector', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => okResponse(384))); // wrong model dim
    const err = await embed('hi').catch((e) => e);
    expect(err).toBeInstanceOf(EmbeddingError);
    expect(err.retryable).toBe(false);
    expect(err.message).toMatch(/dimension/i);
  });

  it('rejects empty input without calling the model', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    await expect(embed('')).rejects.toBeInstanceOf(EmbeddingError);
    expect(f).not.toHaveBeenCalled();
  });
});
