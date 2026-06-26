import { beforeAll, describe, expect, it } from 'vitest';
import { buildCodeGraph, kindOf, layerOf } from './code-graph.mjs';

describe('layerOf', () => {
  it('maps Clean Architecture layers by path', () => {
    expect(layerOf('src/app/core/domain/entities/product.entity.ts')).toBe('domain');
    expect(layerOf('src/app/core/application/use-cases/x.use-case.ts')).toBe('application');
    expect(layerOf('src/app/core/infrastructure/repositories/x.repository.ts')).toBe('infrastructure');
    expect(layerOf('src/app/features/pos-terminal/x.component.ts')).toBe('feature');
    expect(layerOf('src/app/shared/ui/x.ts')).toBe('shared');
  });
});

describe('kindOf', () => {
  it('classifies symbols by path', () => {
    expect(kindOf('a/persist-transaction.use-case.ts')).toBe('useCase');
    expect(kindOf('a/transaction.repository.interface.ts')).toBe('interface');
    expect(kindOf('a/repositories/api-product.repository.ts')).toBe('repository');
    expect(kindOf('a/core/domain/entities/product.entity.ts')).toBe('entity');
    expect(kindOf('a/x.component.ts')).toBe('component');
  });
});

describe('buildCodeGraph (over the repo)', () => {
  let g;
  beforeAll(() => {
    g = buildCodeGraph(process.cwd());
  }, 120000);

  it('produces files, symbols, and edges', () => {
    expect(g.files.length).toBeGreaterThan(100);
    expect(g.symbols.length).toBeGreaterThan(20);
    expect(g.edges.length).toBeGreaterThan(100);
    expect(g.layers).toContain('application');
    expect(g.layers).toContain('domain');
  });

  it('tags the persist-transaction use-case file as the application layer', () => {
    const f = g.files.find((x) => x.id.endsWith('persist-transaction.use-case.ts'));
    expect(f?.layer).toBe('application');
  });

  it('captures a DEPENDS_ON from the use case to its repository interface', () => {
    const dep = g.edges.find(
      (e) =>
        e.type === 'DEPENDS_ON' &&
        e.from.id.endsWith('persist-transaction.use-case.ts#PersistTransactionUseCase') &&
        e.to.id.endsWith('transaction.repository.interface.ts#ITransactionRepository'),
    );
    expect(dep).toBeTruthy();
  });

  it('resolves a @core/... alias import into an IMPORTS edge', () => {
    const imp = g.edges.find(
      (e) => e.type === 'IMPORTS' && e.from.id.endsWith('persist-transaction.use-case.ts'),
    );
    expect(imp).toBeTruthy();
    expect(imp.to.id).toMatch(/^src\/app\/core\//);
  });

  it('File node ids match the path-without-range used by rag_embeddings', () => {
    // rag_embeddings source_id = `${path}:${start}-${end}`; File node id == path.
    const f = g.files.find((x) => x.id.endsWith('persist-transaction.use-case.ts'));
    expect(f.id).toMatch(/^src\/.*\.ts$/);
    expect(f.id).not.toMatch(/:\d+-\d+$/);
  });
});
