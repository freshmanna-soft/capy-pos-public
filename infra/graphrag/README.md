# GraphRAG store infra (`capy-rag-db`)

Infrastructure-as-code for the shared GraphRAG knowledge store (epic #55). This is the
version-controlled source of truth for the Postgres image + schema that the
`scripts/graphrag/` tooling talks to.

## What's here

| File | Purpose |
|------|---------|
| `Dockerfile` | Postgres 16 with **pgvector** + **Apache AGE** compiled in (one image, both pillars). |
| `docker-compose.yml` | Standalone `capy-rag-db` service (host port **5433**, named volume). |
| `migrations/0001_init_vector_store.sql` | Idempotent: `vector` extension + `rag_embeddings` table (embedding `vector(768)`, HNSW cosine index, unique `(source_type, source_id)`). |
| `migrations/0002_init_age_graph.sql` | Idempotent: enables **Apache AGE** + bootstraps the `capy_kg` knowledge graph (graph pillar, #62). |
| `.env.example` | Template — copy to `.env` and set `CAPY_RAG_DB_PASSWORD`. `.env` is gitignored. |

The graph pillar (Apache AGE) is enabled by migration `0002` (#62), which creates the
`capy_kg` graph. Nodes/edges are populated by later Phase 2 stories (#63–#66).

**Using the graph (AGE):** AGE's `cypher(...)` helper lives in `ag_catalog` and must be
loaded per connection. Any session that queries the graph must first run:

```sql
LOAD 'age';
SET search_path = ag_catalog, "$user", public;
SELECT * FROM cypher('capy_kg', $$ MATCH (n) RETURN n $$) AS (n agtype);
```

Plain pgvector queries against `rag_embeddings` do **not** need this.

## Bring it up

```bash
cd infra/graphrag
cp .env.example .env          # set a real CAPY_RAG_DB_PASSWORD
docker compose up -d --build
docker exec -i capy-rag-db psql -U capy -d capy_rag -f /migrations/0001_init_vector_store.sql
```

Connect: `postgres://capy:<pw>@localhost:5433/capy_rag`

## Using it from the tooling

```bash
export RAG_DB_URL="postgres://capy:<pw>@localhost:5433/capy_rag"

# Vector pillar
node scripts/graphrag/index-codebase.mjs        # embed the codebase corpus
node scripts/graphrag/query.mjs "..." --k 5     # top-k semantic search

# Graph pillar (capy_kg)
node scripts/graphrag/index-code-graph.mjs      # code structure (files/symbols/deps)
node scripts/graphrag/index-issue-graph.mjs     # GitHub issue graph (epic/story/blocks)
node scripts/graphrag/index-memory-graph.mjs    # claude-mem [[link]] graph

# GraphRAG: semantic hit -> graph neighborhood, and graph traversal
node scripts/graphrag/graph-query.mjs "where is checkout total calculated" --k 5
node scripts/graphrag/graph-query.mjs --file src/app/.../x.ts   # file neighborhood
node scripts/graphrag/graph-query.mjs --epic 55                 # stories of an epic

# Shared HTTP retrieval endpoint (#81) — one surface for all consumers
npm run graphrag:serve                           # GRAPHRAG_PORT (default 37777)
#   GET  /health
#   POST /search  {query, k?}   → top-k hits + graph neighborhood
#   GET  /file?path=<relpath>   → file neighborhood
#   GET  /epic?number=<n>       → stories of an epic
#   POST /reindex               → trigger incremental reindex (#99); requires
#                                 GRAPHRAG_WEBHOOK_SECRET + matching x-webhook-secret
#                                 header (disabled/503 if the secret is unset)

npm run test:graphrag                            # unit tests

# Refresh the whole store in one command (vector + all graphs; idempotent)
npm run graphrag:reindex                              # full
node scripts/graphrag/reindex-all.mjs --incremental   # only re-embed changed files (#79)
npm run graphrag:refresh-graphs                       # issue + memory subgraphs only (~1s, no Ollama) (#80)
```

## Consumers (#82)

All three agent surfaces hit the same `/search` endpoint (start it with `npm run graphrag:serve`).

**Universal client** (`scripts/graphrag/client.mjs`) — used by scripts/agents, or directly:

```bash
GRAPHRAG_ENDPOINT=http://localhost:37777 node scripts/graphrag/client.mjs "where is checkout total computed" --k 5
node scripts/graphrag/client.mjs --file src/app/core/application/facades/pos.facade.ts
node scripts/graphrag/client.mjs --epic 55
```

**Cloud `.claude` subagents** — call the endpoint with `curl` (or wrap as a project skill):

```bash
curl -s localhost:37777/search -H 'content-type: application/json' -d '{"query":"...","k":5}'
```

**Local Ollama `capy-*` agents** — same HTTP `POST /search` (they already speak HTTP per `ollama-agents`).

**n8n** — an **HTTP Request** node: method `POST`, URL `http://host.docker.internal:37777/search`
(from the n8n container), JSON body `{ "query": "{{ $json.query }}", "k": 5 }`. Feed `hits[]`
(chunk + `graph` neighborhood) into the agent's context.

**MCP server** (`scripts/graphrag/mcp-server.mjs`, #90) — exposes GraphRAG to cloud
`.claude` subagents as native tools (`graphrag_search` / `graphrag_file` / `graphrag_epic`).
Register it (per-environment opt-in) by adding to `.mcp.json` (or Claude settings):

```json
{
  "mcpServers": {
    "capy-graphrag": {
      "command": "node",
      "args": ["scripts/graphrag/mcp-server.mjs"],
      "env": { "GRAPHRAG_ENDPOINT": "http://localhost:37777" }
    }
  }
}
```

(The server proxies the HTTP endpoint, so `npm run graphrag:serve` must be running.)

> **Activation is per-environment and intentionally left to you:** registering the MCP
> server above, editing the live n8n workflow, or wiring a GitHub push webhook to
> `graphrag:reindex --incremental`. The client, endpoint, and MCP server are the shared
> contract; flipping them on touches your machine/services.

Issues and memory change more often than code, so `graphrag:refresh-graphs` is the
cheap path to keep those subgraphs current. To run it on a schedule (opt-in), add a
cron entry, e.g. every 15 min:

```cron
*/15 * * * * cd /path/to/capy-pos && RAG_DB_URL=postgres://capy:<pw>@localhost:5433/capy_rag npm run graphrag:refresh-graphs >>/tmp/graphrag-graphs.log 2>&1
```

## Auto-refresh on change (opt-in)

`reindex-all` is safe to run on every repo update, but auto-running it from a git
hook executes code (and needs Ollama + capy-rag-db up), so it is **not installed
by default**. To enable it for your machine, add a `.husky/post-merge` hook that
only fires when you've opted in via `RAG_DB_URL` and never blocks the merge:

```sh
#!/usr/bin/env sh
# Opt-in, non-blocking GraphRAG refresh.
if [ -n "$RAG_DB_URL" ]; then
  nohup npm run graphrag:reindex >/tmp/graphrag-reindex.log 2>&1 &
fi
exit 0
```

(Incremental, changed-files-only refresh is issue #79; auto-refresh of just the
issue/memory subgraphs is #80.)

## Note on the local n8n stack

In the maintainer's local setup the same `capy-rag-db` service is also defined inline in
`~/n8n-local/docker-compose.yml` so it shares the n8n docker stack. That deployment and the
files here must be kept in sync — **this directory is canonical**; update here first, then
mirror into `~/n8n-local/capy-rag-db/` (or point that stack's build context at this dir).
