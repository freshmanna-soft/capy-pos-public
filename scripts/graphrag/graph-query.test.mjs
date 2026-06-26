import { describe, expect, it } from 'vitest';
import { parseAgtype, fileNeighborhood } from './graph-query.mjs';

describe('parseAgtype', () => {
  it('parses agtype scalars (quoted strings, numbers, bool, null)', () => {
    expect(parseAgtype('"src/app/x.ts"')).toBe('src/app/x.ts');
    expect(parseAgtype('42')).toBe(42);
    expect(parseAgtype('true')).toBe(true);
    expect(parseAgtype(null)).toBeNull();
  });
  it('returns the raw value when not JSON', () => {
    expect(parseAgtype('notjson::vertex')).toBe('notjson::vertex');
  });
});

/** Fake pg pool whose client.query answers by matching the Cypher text. */
function fakePool(answer) {
  return {
    connect: async () => ({
      query: async (sql) => ({ rows: answer(sql) }),
      release: () => {},
    }),
  };
}

describe('fileNeighborhood', () => {
  it('shapes layer/imports/importedBy/symbols from agtype rows', async () => {
    const pool = fakePool((sql) => {
      if (sql.includes('IN_LAYER')) return [{ c0: '"application"' }];
      if (sql.includes(')-[:IMPORTS]->(t:File)')) return [{ c0: '"src/a.ts"' }, { c0: '"src/b.ts"' }];
      if (sql.includes('(s:File)-[:IMPORTS]->')) return [{ c0: '"src/c.ts"' }];
      if (sql.includes('DEFINED_IN')) return [{ c0: '"PersistTransactionUseCase"', c1: '"useCase"' }];
      return []; // LOAD / SET
    });

    const n = await fileNeighborhood(pool, 'src/app/core/application/use-cases/persist-transaction.use-case.ts');
    expect(n.layer).toBe('application');
    expect(n.imports).toEqual(['src/a.ts', 'src/b.ts']);
    expect(n.importedBy).toEqual(['src/c.ts']);
    expect(n.symbols).toEqual([{ name: 'PersistTransactionUseCase', kind: 'useCase' }]);
  });
});
