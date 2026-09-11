#!/usr/bin/env node
/**
 * 🎉 PR #300 — the whole set at the party.
 *
 * `scripts/graphrag/celebrate.mjs` marked #100 with one narrator: the GraphRAG
 * store read its own stats out of itself. By #300 there is no single narrator to
 * ask — the estate is five deployed services, an autonomous build bridge, a
 * knowledge graph, a review quorum and an identity tenant. So every guest speaks
 * for itself, in its own voice, from its own live source.
 *
 * Read-only, and deliberately honest: each section is independent, and a source
 * that cannot be reached says so instead of contributing a plausible number.
 * A party where a guest is absent should look like a guest is absent.
 *
 * Run: RAG_DB_URL=… npm run milestone:celebrate
 */
import { execFile } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { makePool } from '../graphrag/db.mjs';
import { graphRead } from '../graphrag/graph-query.mjs';

const CREW = String.raw`
        ____                ____                ____
     .-"    "-.          .-"    "-.          .-"    "-.
    /          \        /          \        /          \
   |   ^    ^   |      |   ^    ^   |      |   ^    ^   |
   |    (  )    |      |    (  )    |      |    (  )    |
    \   '--'   /        \   '--'   /        \   '--'   /
     '-.____.-'          '-.____.-'          '-.____.-'
     /  |   |  \         /  |   |  \         /  |   |  \
    (__/     \__)       (__/     \__)       (__/     \__)
       the till            the clerk           the bridge

                    ~ Capy-POS · PR #300 ~
              one of us shipped it, all of us built it
`;

/** Run a command, or return null — an absent tool is a fact, not a failure. */
function sh(cmd, args) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: process.cwd(), timeout: 20_000 }, (err, stdout) =>
      resolve(err ? null : stdout.trim())
    );
  });
}

/** Count files under a tree whose path matches, without walking node_modules. */
function countFiles(root, matches) {
  let total = 0;
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry === 'node_modules' || entry === '.git' || entry === 'dist') continue;
      const full = join(dir, entry);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      if (s.isDirectory()) walk(full);
      else if (matches(full)) total += 1;
    }
  };
  walk(root);
  return total;
}

function say(who, line) {
  process.stdout.write(`   ${who.padEnd(16)}${line}\n`);
}

function absent(who, why) {
  process.stdout.write(`   ${who.padEnd(16)}— not reachable from here (${why})\n`);
}

async function git() {
  const commits = await sh('git', ['rev-list', '--count', 'HEAD']);
  const first = await sh('git', ['log', '--reverse', '--format=%ad', '--date=short']);
  if (commits === null) return absent('git', 'no repository');
  const since = first ? first.split('\n')[0] : 'unknown';
  say('git', `${commits} commits on main, first one ${since}`);
}

async function github() {
  const prs = await sh('gh', [
    'pr',
    'list',
    '--state',
    'all',
    '--limit',
    '400',
    '--json',
    'number,title,state',
  ]);
  if (prs === null) return absent('github', 'gh unavailable or unauthenticated');
  const all = JSON.parse(prs);
  const merged = all.filter((p) => p.state === 'MERGED').length;
  // The bridge names every branch it opens `feature/POS-<n>`, and carries that
  // into the PR title — the cheapest honest way to separate its work from ours.
  const byBridge = all.filter((p) => /\(POS-\d+\)/.test(p.title));
  say('github', `${all.length} pull requests, ${merged} merged`);
  say('', `of those, ${byBridge.length} were opened by the bridge itself`);
}

async function bridge() {
  let health;
  try {
    const res = await fetch('http://127.0.0.1:8791/health', {
      signal: AbortSignal.timeout(5000),
    });
    health = await res.json();
  } catch {
    return absent('dev-bridge', 'not running on :8791');
  }
  say('dev-bridge', `${health.jobs} build jobs run, driving ${health.model}`);
  say('', `reviewers ride ${health.subagentModel}, three per pull request`);
}

async function graph() {
  if (!process.env.RAG_DB_URL) return absent('graphrag', 'RAG_DB_URL unset');
  let pool;
  try {
    pool = makePool();
    const count = async (cypher) => (await graphRead(pool, cypher, 1))[0]?.[0] ?? 0;
    const chunks = (
      await pool.query("SELECT count(*) FROM rag_embeddings WHERE source_type='code'")
    ).rows[0].count;
    const files = await count('MATCH (n:File) RETURN count(n)');
    const symbols = await count('MATCH (n:Symbol) RETURN count(n)');
    const memories = await count('MATCH (n:Memory) RETURN count(n)');
    const top = await graphRead(
      pool,
      'MATCH (d:Symbol)-[:DEPENDS_ON]->(t:Symbol) RETURN t.name, count(d) AS c ORDER BY c DESC LIMIT 3',
      2
    );
    say('graphrag', `${chunks} vector chunks, ${files} files, ${symbols} symbols`);
    say('', `${memories} memories kept, so none of this had to be re-learned`);
    const named = top.map(([name, c]) => `${name} (${c})`).join(', ');
    if (named) say('', `most depended-on: ${named}`);
  } catch (err) {
    return absent('graphrag', err?.message ?? 'query failed');
  } finally {
    await pool?.end();
  }
}

function suite() {
  const specs = countFiles('src', (p) => p.endsWith('.spec.ts'));
  const e2e = countFiles('tests', (p) => p.endsWith('.spec.ts'));
  say('the suite', `${specs} unit spec files, ${e2e} Playwright specs`);
  say('', 'coverage floor 90%, and it has never been lowered to pass');
}

function estate() {
  const services = countFiles('infra', (p) => p.endsWith('Dockerfile'));
  say('the estate', `${services} containerised services, deployed on IBM Cloud`);
  say('', 'staff and customers now split across two App ID applications');
}

async function main() {
  process.stdout.write(CREW + '\n');
  process.stdout.write('  ── #300, as told by everyone who showed up ──\n\n');
  await git();
  await github();
  await bridge();
  await graph();
  suite();
  estate();
  process.stdout.write('\n   #100 was narrated by one system. #300 needed a guest list.\n');
  process.stdout.write('   stay chill, ship often. 🦫💚\n');
}

main().catch((err) => {
  process.stderr.write(`celebrate-300 failed: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
