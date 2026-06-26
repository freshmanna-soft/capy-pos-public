-- Capy-POS GraphRAG store — migration 0001 (issue #56)
-- Provisions the pgvector extension and the embeddings table for the VECTOR pillar.
-- Idempotent: safe to run repeatedly (CREATE ... IF NOT EXISTS throughout).
-- The Apache AGE / graph pillar (Phase 2) lands in a later migration on this same DB.

BEGIN;

-- Vector pillar extension. (Apache AGE is installed in the image but not
-- CREATE EXTENSION-ed here; that is Phase 2 scope.)
CREATE EXTENSION IF NOT EXISTS vector;

-- Embedding store. One row per chunk of an embedded source.
-- nomic-embed-text emits 768-dimensional vectors -> vector(768).
CREATE TABLE IF NOT EXISTS rag_embeddings (
    id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    source_type  text        NOT NULL,                 -- 'code' | 'claude_mem' | 'github_issue' | 'memory_link'
    source_id    text        NOT NULL,                 -- canonical id (e.g. 'path:line_start-line_end') reused by the graph pillar + the self-updating loop
    chunk        text        NOT NULL,                 -- the embedded text
    embedding    vector(768) NOT NULL,                 -- nomic-embed-text dimension
    metadata     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);

-- Canonical identity is unique -> enables upsert-in-place (ON CONFLICT) for the
-- codebase indexer (#58) and incremental re-indexing (Phase 3); prevents duplicate rows.
CREATE UNIQUE INDEX IF NOT EXISTS rag_embeddings_source_uidx
    ON rag_embeddings (source_type, source_id);

-- Approximate nearest-neighbour index for similarity search. HNSW builds fine on an
-- empty table (no training set required, unlike ivfflat) and gives strong recall.
-- Cosine distance matches how nomic-embed-text embeddings are compared.
CREATE INDEX IF NOT EXISTS rag_embeddings_embedding_hnsw
    ON rag_embeddings USING hnsw (embedding vector_cosine_ops);

-- Fast filtering when a query is scoped to one corpus.
CREATE INDEX IF NOT EXISTS rag_embeddings_source_type_idx
    ON rag_embeddings (source_type);

COMMIT;
