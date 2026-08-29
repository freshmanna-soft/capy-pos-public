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
 *
 * The scan covers every bucket npm installs from, not just the two this repo happens
 * to use today. A driver moved to `optionalDependencies` is installed exactly the
 * same, so a scan that read only `dependencies`/`devDependencies` would wave it
 * through while still reporting "no SQL driver left anywhere in package.json".
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

/** Every package.json field npm resolves installable dependencies from. */
const DEPENDENCY_BUCKETS = [
  'dependencies',
  'devDependencies',
  'optionalDependencies',
  'peerDependencies',
] as const;

type DependencyBucket = (typeof DEPENDENCY_BUCKETS)[number];

type Manifest = Partial<Record<DependencyBucket, Record<string, string>>> & Record<string, unknown>;

/** Package names declared across every scanned bucket. */
function declaredPackages(manifest: Manifest): string[] {
  return DEPENDENCY_BUCKETS.flatMap((bucket) => Object.keys(manifest[bucket] ?? {}));
}

/** Declared packages whose name reads as a SQL driver. */
function sqlishPackages(manifest: Manifest): string[] {
  return declaredPackages(manifest).filter(
    (name) => /sqlite|\bsql\b/i.test(name) && name !== 'dexie'
  );
}

describe('persistence dependencies (#208)', () => {
  const packageJson = JSON.parse(
    readFileSync(resolve(process.cwd(), 'package.json'), 'utf-8')
  ) as Manifest;

  it('declares Dexie as the store', () => {
    // Guards the inverse of the assertion below: "no SQLite" is only meaningful
    // while something is actually providing persistence.
    expect(packageJson.dependencies?.['dexie']).toBeDefined();
  });

  it.each(FORBIDDEN_PERSISTENCE_PACKAGES)(
    'does not declare %s — the store is Dexie, not SQL',
    (pkg) => {
      expect(declaredPackages(packageJson)).not.toContain(pkg);
    }
  );

  it('has no SQL driver left anywhere in package.json', () => {
    // Catches the near-misses the explicit list above cannot enumerate
    // (`node-sqlite3-wasm`, `bun:sqlite` shims, a re-exported fork, …).
    expect(sqlishPackages(packageJson)).toEqual([]);
  });

  it('declares no dependency bucket this guard does not scan', () => {
    // Should package.json ever grow another `*[Dd]ependencies` field (npm's
    // `bundleDependencies`, a tool-specific one), this fails until the scan is
    // extended, rather than letting "anywhere in package.json" quietly shrink.
    const unscanned = Object.keys(packageJson).filter(
      (key) =>
        /[Dd]ependencies$/.test(key) && !(DEPENDENCY_BUCKETS as readonly string[]).includes(key)
    );

    expect(unscanned).toEqual([]);
  });

  describe('scan coverage', () => {
    // The bucket list *is* the guard: a driver in an unscanned bucket is installed
    // just the same, and every assertion above would still pass. These buckets are
    // written out literally rather than derived from DEPENDENCY_BUCKETS — iterating
    // the list under test would shrink the fixtures along with it.
    it.each(['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'])(
      'flags a SQL driver declared in %s',
      (bucket) => {
        const manifest = { [bucket]: { 'better-sqlite3': '^12.4.1' } } as Manifest;

        expect(declaredPackages(manifest)).toContain('better-sqlite3');
        expect(sqlishPackages(manifest)).toEqual(['better-sqlite3']);
      }
    );

    it('keeps dexie out of the SQL-driver match', () => {
      const manifest = { dependencies: { dexie: '^4.0.0' } } as Manifest;

      expect(sqlishPackages(manifest)).toEqual([]);
    });
  });
});
