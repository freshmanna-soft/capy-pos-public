#!/usr/bin/env node
/**
 * 🎉 100th-PR celebration — narrated by the GraphRAG layer it helped build.
 *
 * Read-only: queries the live store (rag_embeddings + the capy_kg graph) for
 * real stats and a couple of fun graph facts, then prints a capybara milestone
 * card. Run: RAG_DB_URL=… node scripts/graphrag/celebrate.mjs
 */
import { makePool } from './db.mjs';
import { graphRead } from './graph-query.mjs';

const CAPY = String.raw`
            ____
         .-"    "-.
        /          \        ~ Capy-POS ~
       |   ^    ^   |      100 pull requests
       |    (  )    |        and counting
        \   '--'   /
         '-.____.-'
        /  |    |  \
       (__/      \__)   stay chill, ship often
`;

async function count(pool, cypher) {
  const rows = await graphRead(pool, cypher, 1);
  return rows[0]?.[0] ?? 0;
}

async function main() {
  const pool = makePool();
  try {
    const vec = (await pool.query("SELECT count(*) FROM rag_embeddings WHERE source_type='code'")).rows[0].count;
    const files = await count(pool, 'MATCH (n:File) RETURN count(n)');
    const symbols = await count(pool, 'MATCH (n:Symbol) RETURN count(n)');
    const issues = await count(pool, 'MATCH (n:Issue) RETURN count(n)');
    const memories = await count(pool, 'MATCH (n:Memory) RETURN count(n)');
    const epics = await count(pool, 'MATCH (n:Issue) WHERE n.is_epic = true RETURN count(n)');

    // Fun graph fact: the most depended-on symbols.
    const topDeps = await graphRead(
      pool,
      'MATCH (d:Symbol)-[:DEPENDS_ON]->(t:Symbol) RETURN t.name, count(d) AS c ORDER BY c DESC LIMIT 3',
      2,
    );
    // The GraphRAG epic and how many stories carried it.
    const epicStories = await count(pool, "MATCH (:Issue)-[:PART_OF]->(:Issue {id:'55'}) RETURN count(*)");

    process.stdout.write(CAPY + '\n');
    process.stdout.write('  ── milestone, as told by the GraphRAG store it built ──\n\n');
    process.stdout.write(`   vector chunks indexed : ${vec}\n`);
    process.stdout.write(`   graph nodes           : ${files} files · ${symbols} symbols · ${issues} issues · ${memories} memories\n`);
    process.stdout.write(`   epics tracked         : ${epics}\n`);
    process.stdout.write(`   stories that built me : ${epicStories} (epic #55, Phases 1–4)\n`);
    process.stdout.write('\n   most depended-on symbols (per the code graph):\n');
    for (const [name, c] of topDeps) process.stdout.write(`     • ${name} — ${c} dependents\n`);
    process.stdout.write('\n   one Postgres, two pillars (pgvector + Apache AGE), ~86% fewer tokens/task.\n');
    process.stdout.write('   thanks for 100. 🦫💚\n');
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  process.stderr.write(`celebrate failed: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
