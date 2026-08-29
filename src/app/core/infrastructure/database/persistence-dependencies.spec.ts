/**
 * Persistence dependency guard (issue #208).
 *
 * The app migrated off sql.js / `better-sqlite3` to Dexie (IndexedDB) — see
 * docs/DEXIE_MIGRATION.md — and the SQLite repositories were deleted rather than
 * ported. `better-sqlite3` nonetheless stayed in `dependencies` long after its last
 * usage disappeared, which is how it ended up in #208: a native-compiling driver
 * that CI only tolerated because `npm ci --ignore-scripts` never built it, and which
 * kept reading as "this project has a SQLite layer" to anyone scanning package.json.
 *
 * Nothing else fails when an unused driver is declared, so this is the test that
 * does. It asserts the *declaration*, not the imports: a dependency with no call
 * sites is invisible to every other spec in the suite by definition.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';

/** Packages that would signal a second, competing persistence stack. */
const FORBIDDEN_PERSISTENCE_PACKAGES = [
  'better-sqlite3',
  '@types/better-sqlite3',
  'sql.js',
  '@types/sql.js',
  'sqlite3',
  'typeorm',
  'knex',
];

describe('persistence dependencies (#208)', () => {
  const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  const declared = {
    ...(packageJson.dependencies ?? {}),
    ...(packageJson.devDependencies ?? {}),
  };

  it('declares Dexie as the store', () => {
    // Guards the inverse of the assertion below: "no SQLite" is only meaningful
    // while something is actually providing persistence.
    expect(packageJson.dependencies?.['dexie']).toBeDefined();
  });

  it.each(FORBIDDEN_PERSISTENCE_PACKAGES)(
    'does not declare %s — the store is Dexie, not SQL',
    (pkg) => {
      expect(Object.keys(declared)).not.toContain(pkg);
    }
  );

  it('has no SQL driver left anywhere in package.json', () => {
    // Catches the near-misses the explicit list above cannot enumerate
    // (`node-sqlite3-wasm`, `bun:sqlite` shims, a re-exported fork, …).
    const sqlish = Object.keys(declared).filter(
      (name) => /sqlite|\bsql\b/i.test(name) && name !== 'dexie'
    );
    expect(sqlish).toEqual([]);
  });
});
