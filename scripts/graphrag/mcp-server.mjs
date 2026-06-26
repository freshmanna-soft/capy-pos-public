#!/usr/bin/env node
/**
 * GraphRAG MCP server (issue #90) — exposes the retrieval layer to cloud
 * `.claude` subagents (and any MCP client) as native tools, wrapping the HTTP
 * client (client.mjs → endpoint #81).
 *
 * Minimal stdio JSON-RPC 2.0 (newline-delimited) — no SDK dependency. Tools:
 *   graphrag_search { query, k? }  → top-k hits + graph neighborhood
 *   graphrag_file   { path }       → file graph neighborhood
 *   graphrag_epic   { number }     → stories of an epic
 *
 * Run: GRAPHRAG_ENDPOINT=http://localhost:37777 node scripts/graphrag/mcp-server.mjs
 * Register (per-environment opt-in) in .mcp.json / .claude settings — see README.
 */
import { createInterface } from 'node:readline';
import * as client from './client.mjs';

const SERVER_INFO = { name: 'capy-graphrag', version: '1.0.0' };

const TOOLS = [
  {
    name: 'graphrag_search',
    description: 'Semantic + graph retrieval over the capy-pos codebase/issues/memory. Returns top-k relevant chunks, each with its code-graph neighborhood.',
    inputSchema: {
      type: 'object',
      properties: { query: { type: 'string' }, k: { type: 'number', default: 5 } },
      required: ['query'],
    },
  },
  {
    name: 'graphrag_file',
    description: 'Graph neighborhood of a source file (layer, imports, importedBy, defined symbols) by repo-relative path.',
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
  },
  {
    name: 'graphrag_epic',
    description: 'List the stories that are Part of a given epic issue number.',
    inputSchema: { type: 'object', properties: { number: { type: 'number' } }, required: ['number'] },
  },
];

function ok(id, result) {
  return { jsonrpc: '2.0', id, result };
}
function err(id, code, message) {
  return { jsonrpc: '2.0', id, error: { code, message } };
}
function toolText(obj) {
  return { content: [{ type: 'text', text: JSON.stringify(obj) }] };
}

/**
 * Handle one JSON-RPC message. Returns a response object, or null for
 * notifications (no id). `deps` injects the client (for testing).
 */
export async function handleRequest(msg, deps = client) {
  const { id, method, params } = msg ?? {};
  // Notifications (no id) get no response.
  if (id === undefined || id === null) return null;

  switch (method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return ok(id, {});
    case 'tools/list':
      return ok(id, { tools: TOOLS });
    case 'tools/call': {
      const name = params?.name;
      const args = params?.arguments ?? {};
      try {
        if (name === 'graphrag_search') return ok(id, toolText(await deps.graphRagQuery(args.query, { k: args.k ?? 5 })));
        if (name === 'graphrag_file') return ok(id, toolText(await deps.fileNeighbors(args.path)));
        if (name === 'graphrag_epic') return ok(id, toolText(await deps.epicStories(args.number)));
        return err(id, -32602, `unknown tool: ${name}`);
      } catch (e) {
        return ok(id, { content: [{ type: 'text', text: `error: ${e?.message ?? e}` }], isError: true });
      }
    }
    default:
      return err(id, -32601, `method not found: ${method}`);
  }
}

function isMain() {
  return process.argv[1] && process.argv[1].endsWith('mcp-server.mjs');
}

if (isMain()) {
  const rl = createInterface({ input: process.stdin });
  rl.on('line', async (line) => {
    const text = line.trim();
    if (!text) return;
    let msg;
    try {
      msg = JSON.parse(text);
    } catch {
      process.stdout.write(JSON.stringify(err(null, -32700, 'parse error')) + '\n');
      return;
    }
    const res = await handleRequest(msg);
    if (res) process.stdout.write(JSON.stringify(res) + '\n');
  });
}
