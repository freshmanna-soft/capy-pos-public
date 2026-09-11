/**
 * Import-graph guard for the customer App ID adapter (epic #261 items 11/13).
 *
 * Item 11's review found that `appid-customer-auth.adapter.ts` imported
 * `APPID_CONFIG`/`AppIdConfig` from `appid-auth.adapter.ts`, which made the
 * *staff* adapter a dependency of the customer one. Item 13 broke that edge by
 * moving the shared config surface into `appid-config.ts`. Nothing else in the
 * suite notices if the edge comes back: re-adding
 * `import { APPID_CONFIG } from './appid-auth.adapter'` compiles, lints, and
 * leaves every other spec green — the re-export in that file is there precisely
 * so it keeps working. The DI specs cannot see it either; an injector has no
 * opinion about which module a token was imported from.
 *
 * So this is the test that notices. It walks the *static import graph* from the
 * customer adapter — the thing the bundler walks, resolved through the real
 * tsconfig paths rather than by matching strings — and asserts what it must not
 * reach. Type-only imports are skipped because they are erased before any
 * bundler sees them.
 */

import { describe, it, expect } from 'vitest';
import { Project, type SourceFile } from 'ts-morph';

const CUSTOMER_ADAPTER = 'src/app/core/infrastructure/auth/appid-customer-auth.adapter.ts';

/** Everything the customer adapter pulls in at runtime, transitively. */
function importClosure(entryPath: string): string[] {
  const project = new Project({
    tsConfigFilePath: 'tsconfig.json',
    skipAddingFilesFromTsConfig: true,
  });

  const seen = new Set<string>();
  const stack: SourceFile[] = [project.addSourceFileAtPath(entryPath)];

  while (stack.length > 0) {
    const file = stack.pop() as SourceFile;
    const path = file.getFilePath();
    if (seen.has(path)) continue;
    seen.add(path);

    for (const declaration of [...file.getImportDeclarations(), ...file.getExportDeclarations()]) {
      // Erased at compile time — it costs no bytes and creates no coupling
      // the bundler can act on.
      if (declaration.isTypeOnly()) continue;
      const target = declaration.getModuleSpecifierSourceFile();
      if (target && !target.getFilePath().includes('node_modules')) stack.push(target);
    }
  }

  return [...seen];
}

describe('AppIdCustomerAuthAdapter import graph (#261 items 11/13)', () => {
  const closure = importClosure(CUSTOMER_ADAPTER);
  const reaches = (fileName: string): boolean => closure.some((path) => path.endsWith(fileName));

  it('reaches the shared modules it is supposed to share', () => {
    // The inverse of the assertions below: they are only meaningful while the
    // walk actually resolves this adapter's imports. A resolution failure would
    // otherwise read as "reaches nothing forbidden".
    expect(reaches('/appid-config.ts')).toBe(true);
    expect(reaches('/appid-jwks.ts')).toBe(true);
    expect(closure.length).toBeGreaterThan(5);
  });

  it('does not reach the staff adapter', () => {
    expect(reaches('/appid-auth.adapter.ts')).toBe(false);
  });

  it('does not reach auth.providers.ts, which would drag in every adapter', () => {
    expect(reaches('/auth.providers.ts')).toBe(false);
  });
});
