-- Capy-POS GraphRAG store — migration 0002 (issue #62)
-- Enables the GRAPH pillar: Apache AGE extension + the shared knowledge graph.
-- Idempotent: safe to run repeatedly.
--
-- AGE is compiled into the capy-rag-db image (migration 0001 set up the vector
-- pillar). This migration only enables the extension and bootstraps the graph;
-- nodes/edges are populated by later Phase 2 stories (#63 code, #64 issues,
-- #65 memory links) and queried in #66.
--
-- IMPORTANT for callers: AGE functions and the `cypher(...)` helper live in the
-- `ag_catalog` schema and require the extension to be LOADed into the session.
-- Every connection that uses the graph must run, once per session:
--     LOAD 'age';
--     SET search_path = ag_catalog, "$user", public;
-- (Plain pgvector queries against rag_embeddings do NOT need this.)

CREATE EXTENSION IF NOT EXISTS age;

LOAD 'age';
SET search_path = ag_catalog, "$user", public;

-- create_graph() throws if the graph already exists, so guard it for idempotency.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM ag_catalog.ag_graph WHERE name = 'capy_kg') THEN
    PERFORM ag_catalog.create_graph('capy_kg');
  END IF;
END $$;
