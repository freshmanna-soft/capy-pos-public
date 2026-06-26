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

npm run test:graphrag                            # unit tests
```

## Note on the local n8n stack

In the maintainer's local setup the same `capy-rag-db` service is also defined inline in
`~/n8n-local/docker-compose.yml` so it shares the n8n docker stack. That deployment and the
files here must be kept in sync — **this directory is canonical**; update here first, then
mirror into `~/n8n-local/capy-rag-db/` (or point that stack's build context at this dir).
