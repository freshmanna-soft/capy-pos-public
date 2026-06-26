import { describe, expect, it, vi } from 'vitest';
import { handleRequest } from './mcp-server.mjs';

describe('MCP handleRequest', () => {
  it('responds to initialize with capabilities + serverInfo', async () => {
    const res = await handleRequest({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
    expect(res.result.serverInfo.name).toBe('capy-graphrag');
    expect(res.result.capabilities.tools).toBeDefined();
    expect(res.result.protocolVersion).toBe('2025-06-18'); // echoes client version
  });

  it('lists the three graphrag tools', async () => {
    const res = await handleRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    expect(res.result.tools.map((t) => t.name)).toEqual(['graphrag_search', 'graphrag_file', 'graphrag_epic']);
  });

  it('returns null for notifications (no id)', async () => {
    expect(await handleRequest({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
  });

  it('dispatches tools/call to the client and wraps the result as text content', async () => {
    const deps = {
      graphRagQuery: vi.fn(async () => ({ hits: [{ sourceId: 'x', chunk: 'y' }] })),
      fileNeighbors: vi.fn(),
      epicStories: vi.fn(),
    };
    const res = await handleRequest(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'graphrag_search', arguments: { query: 'q', k: 2 } } },
      deps,
    );
    expect(deps.graphRagQuery).toHaveBeenCalledWith('q', { k: 2 });
    expect(JSON.parse(res.result.content[0].text).hits).toHaveLength(1);
  });

  it('reports a tool error as isError content, not a transport error', async () => {
    const deps = { graphRagQuery: vi.fn(async () => { throw new Error('endpoint down'); }) };
    const res = await handleRequest(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'graphrag_search', arguments: { query: 'q' } } },
      deps,
    );
    expect(res.result.isError).toBe(true);
    expect(res.result.content[0].text).toMatch(/endpoint down/);
  });

  it('errors on unknown method', async () => {
    const res = await handleRequest({ jsonrpc: '2.0', id: 5, method: 'bogus' });
    expect(res.error.code).toBe(-32601);
  });
});
