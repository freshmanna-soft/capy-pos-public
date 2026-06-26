import { describe, expect, it, vi } from 'vitest';
import { search } from './query.mjs';

const fakeEmbed = () => Promise.resolve(Array.from({ length: 768 }, () => 0.1));

function fakePool(rows) {
  return { query: vi.fn(async () => ({ rows })), end: vi.fn(async () => {}) };
}

describe('search', () => {
  it('embeds the query and returns shaped top-k hits', async () => {
    const pool = fakePool([
      {
        source_id: 'src/a.ts:1-20',
        chunk: 'function total() {}',
        metadata: { path: 'src/a.ts', start_line: 1, end_line: 20 },
        score: 0.91,
      },
    ]);
    const hits = await search('how is total computed', { k: 3, pool, embedFn: fakeEmbed });

    expect(hits).toHaveLength(1);
    expect(hits[0]).toEqual({
      sourceId: 'src/a.ts:1-20',
      path: 'src/a.ts',
      startLine: 1,
      endLine: 20,
      score: 0.91,
      chunk: 'function total() {}',
    });
    // k flows through to the LIMIT parameter
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [expect.any(String), 'code', 3]);
  });

  it('returns an empty array (no error) when the store has no matching rows', async () => {
    const pool = fakePool([]);
    await expect(search('anything', { pool, embedFn: fakeEmbed })).resolves.toEqual([]);
  });

  it('defaults k to 5 and source type to code', async () => {
    const pool = fakePool([]);
    await search('q', { pool, embedFn: fakeEmbed });
    expect(pool.query).toHaveBeenCalledWith(expect.any(String), [expect.any(String), 'code', 5]);
  });

  it('does not close an injected pool (caller owns it)', async () => {
    const pool = fakePool([]);
    await search('q', { pool, embedFn: fakeEmbed });
    expect(pool.end).not.toHaveBeenCalled();
  });

  it('rejects an empty query', async () => {
    await expect(search('   ', { embedFn: fakeEmbed })).rejects.toThrow(/non-empty/);
  });
});
