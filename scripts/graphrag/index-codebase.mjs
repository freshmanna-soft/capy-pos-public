#!/usr/bin/env node
/**
 * Codebase indexer (issue #58) — the first GraphRAG corpus.
 *
 * Walks the repo's source dirs, chunks each file on line boundaries (chunker.mjs),
 * embeds every chunk via the local Ollama service (#57), and upserts the chunks
 * into the vector store (#56) under a canonical id of `path:startLine-endLine`.
 *
 * Re-running is idempotent: each file's rows are replaced atomically, so chunk
 * counts stay stable and no duplicate/orphan rows accumulate.
 *
 * Usage:
 *   RAG_DB_URL=postgres://capy:<pw>@localhost:5433/capy_rag \
 *     node scripts/graphrag/index-codebase.mjs [--root <dir> ...] [--dry]
 *
 *   --dry   chunk + report only; no embedding, no DB writes.
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, extname } from 'node:path';
import { chunkFile } from './chunker.mjs';
import { embed } from './embedding-service.mjs';
import { makePool, upsertFileChunks } from './db.mjs';

const REPO_ROOT = process.cwd();
const DEFAULT_ROOTS = ['src', 'scripts', 'tools'];
const EXT_LANG = { '.ts': 'ts', '.html': 'html', '.scss': 'scss', '.css': 'css', '.mjs': 'js', '.js': 'js' };
const IGNORE_DIRS = new Set([
  'node_modules', 'dist', 'coverage', '.angular', '.git',
  'test-results', 'playwright-report',
]);

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return; // missing root dir — skip
  }
  for (const e of entries) {
    if (e.isDirectory()) {
      if (IGNORE_DIRS.has(e.name)) continue;
      yield* walk(join(dir, e.name));
    } else if (e.isFile() && extname(e.name) in EXT_LANG) {
      yield join(dir, e.name);
    }
  }
}

function parseArgs(argv) {
  const roots = [];
  let dry = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--dry') dry = true;
    else if (argv[i] === '--root') roots.push(argv[(i += 1)]);
  }
  return { roots: roots.length ? roots : DEFAULT_ROOTS, dry };
}

async function main() {
  const { roots, dry } = parseArgs(process.argv.slice(2));
  const pool = dry ? null : makePool();

  let files = 0;
  let chunks = 0;
  let written = 0;
  const t0 = Date.now();

  try {
    for (const root of roots) {
      for await (const abs of walk(join(REPO_ROOT, root))) {
        const relPath = relative(REPO_ROOT, abs);
        const lang = EXT_LANG[extname(abs)];
        const content = await readFile(abs, 'utf8');
        const fileChunks = chunkFile(content);
        if (fileChunks.length === 0) continue;
        files += 1;
        chunks += fileChunks.length;

        if (dry) {
          process.stdout.write(`DRY ${relPath} → ${fileChunks.length} chunk(s)\n`);
          continue;
        }

        const rows = [];
        for (const c of fileChunks) {
          const embedding = await embed(c.text); // serialized inside the service
          rows.push({
            sourceId: `${relPath}:${c.startLine}-${c.endLine}`,
            startLine: c.startLine,
            endLine: c.endLine,
            text: c.text,
            embedding,
          });
        }
        written += await upsertFileChunks(pool, { path: relPath, lang, rows });
        process.stdout.write(`indexed ${relPath} (${rows.length})\n`);
      }
    }
  } finally {
    if (pool) await pool.end();
  }

  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  process.stdout.write(
    `\n${dry ? 'DRY ' : ''}done: ${files} files, ${chunks} chunks${dry ? '' : `, ${written} rows upserted`} in ${secs}s\n`,
  );
}

main().catch((err) => {
  process.stderr.write(`index-codebase failed: ${err?.message ?? err}\n`);
  process.exitCode = 1;
});
