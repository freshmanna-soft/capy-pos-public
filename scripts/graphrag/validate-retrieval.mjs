#!/usr/bin/env node
/**
 * Phase 1 retrieval-quality validation (issue #60).
 *
 * Runs a fixed set of real "find the code that does X" queries against the
 * indexed codebase corpus and checks whether an expected file lands in the
 * top-k results. Prints a table + hit rate and exits non-zero on no-go so it
 * can double as a regression gate.
 *
 * Bar:  hit = any expected path substring appears in top-K (default K=5)
 * Gate: GO if hitRate >= THRESHOLD (default 0.8)
 *
 * Usage: RAG_DB_URL=... node scripts/graphrag/validate-retrieval.mjs [--k 5]
 */
import { search } from './query.mjs';
import { makePool } from './db.mjs';

const K = (() => {
  const i = process.argv.indexOf('--k');
  return i >= 0 ? Number(process.argv[i + 1]) : 5;
})();
const THRESHOLD = 0.8;

// Each query lists acceptable target path substrings (any one in top-K = hit).
const QUERIES = [
  { q: 'how are cart totals calculated', expect: ['calculate-cart-totals', 'cart-totals'] },
  { q: 'offline sync engine that pushes changes to the server', expect: ['sync.service', 'sync.worker'] },
  { q: 'Dexie IndexedDB database setup and schema', expect: ['dexie-database'] },
  { q: 'publish and subscribe to domain events on the event bus', expect: ['event-bus.service', 'event-bus.events'] },
  { q: 'generate a printable receipt for a transaction', expect: ['generate-receipt', 'receipt.component'] },
  { q: 'repository that fetches products from the API', expect: ['api-product.repository', 'product.repository'] },
  { q: 'inventory management of stock levels', expect: ['inventory-management', 'inventory'] },
  { q: 'process a cash payment', expect: ['process-cash-payment', 'payment.agent', 'payment.repository'] },
  { q: 'product search component for the POS terminal', expect: ['product-search'] },
  { q: 'shopping cart add and remove items', expect: ['shopping-cart', 'cart.service'] },
];

function pad(s, n) {
  return (s + ' '.repeat(n)).slice(0, n);
}

async function main() {
  const pool = makePool();
  let hits = 0;
  const lines = [];
  try {
    for (const { q, expect } of QUERIES) {
      const results = await search(q, { k: K, pool });
      const paths = results.map((r) => r.path ?? r.sourceId);
      const hitIdx = paths.findIndex((p) => expect.some((e) => p.includes(e)));
      const ok = hitIdx >= 0;
      if (ok) hits += 1;
      lines.push(
        `| ${ok ? '✅' : '❌'} | ${pad(q, 52)} | ${ok ? `#${hitIdx + 1} ${paths[hitIdx]}` : `expected ${expect.join('|')} — not in top-${K}`} |`,
      );
    }
  } finally {
    await pool.end();
  }

  const rate = hits / QUERIES.length;
  const verdict = rate >= THRESHOLD ? 'GO' : 'NO-GO';
  process.stdout.write(`\n| hit | query | top result matched |\n|----|----|----|\n${lines.join('\n')}\n`);
  process.stdout.write(`\nHit rate: ${hits}/${QUERIES.length} (${(rate * 100).toFixed(0)}%) @ top-${K} — threshold ${THRESHOLD * 100}% → ${verdict}\n`);
  process.exitCode = rate >= THRESHOLD ? 0 : 1;
}

main().catch((err) => {
  process.stderr.write(`validation failed: ${err?.message ?? err}\n`);
  process.exitCode = 2;
});
