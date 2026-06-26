import { afterEach, describe, expect, it, vi } from 'vitest';
import { graphRagQuery, fileNeighbors, epicStories } from './client.mjs';

afterEach(() => vi.unstubAllGlobals());

function stubFetch(impl) {
  vi.stubGlobal('fetch', vi.fn(impl));
  return globalThis.fetch;
}

describe('graphRagQuery', () => {
  it('POSTs query+k to /search and returns JSON', async () => {
    const f = stubFetch(async () => ({ ok: true, json: async () => ({ query: 'q', hits: [{ sourceId: 'x' }] }) }));
    const out = await graphRagQuery('q', { k: 3, endpoint: 'http://e' });
    expect(out.hits).toHaveLength(1);
    expect(f).toHaveBeenCalledWith('http://e/search', expect.objectContaining({ method: 'POST' }));
    expect(JSON.parse(f.mock.calls[0][1].body)).toEqual({ query: 'q', k: 3 });
  });

  it('throws on non-OK responses', async () => {
    stubFetch(async () => ({ ok: false, status: 500, text: async () => 'boom' }));
    await expect(graphRagQuery('q', { endpoint: 'http://e' })).rejects.toThrow(/500/);
  });
});

describe('fileNeighbors / epicStories', () => {
  it('GETs /file with an encoded path', async () => {
    const f = stubFetch(async () => ({ ok: true, json: async () => ({ layer: 'domain' }) }));
    await fileNeighbors('src/a b.ts', { endpoint: 'http://e' });
    expect(f.mock.calls[0][0]).toBe('http://e/file?path=src%2Fa%20b.ts');
  });

  it('GETs /epic with the number', async () => {
    const f = stubFetch(async () => ({ ok: true, json: async () => ({ epic: 55, stories: [] }) }));
    await epicStories(55, { endpoint: 'http://e' });
    expect(f.mock.calls[0][0]).toBe('http://e/epic?number=55');
  });
});
