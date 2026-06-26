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
| `.env.example` | Template — copy to `.env` and set `CAPY_RAG_DB_PASSWORD`. `.env` is gitignored. |

The graph pillar (Apache AGE) ships in the image but is not yet `CREATE EXTENSION`-ed;
that lands in a later migration (Phase 2, issues #62–#66).

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
node scripts/graphrag/index-codebase.mjs      # build the codebase corpus
node scripts/graphrag/query.mjs "..." --k 5   # top-k semantic search
npm run test:graphrag                          # unit tests
```

## Note on the local n8n stack

In the maintainer's local setup the same `capy-rag-db` service is also defined inline in
`~/n8n-local/docker-compose.yml` so it shares the n8n docker stack. That deployment and the
files here must be kept in sync — **this directory is canonical**; update here first, then
mirror into `~/n8n-local/capy-rag-db/` (or point that stack's build context at this dir).
