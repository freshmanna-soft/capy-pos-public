import { describe, expect, it } from 'vitest';
import { buildMemoryGraph, extractLinks } from './memory-graph.mjs';

describe('extractLinks', () => {
  it('extracts non-empty [[links]] and ignores empty placeholders', () => {
    expect(extractLinks('see [[a-b]] and [[ ]] and [[c]]')).toEqual(['a-b', 'c']);
    expect(extractLinks('none here')).toEqual([]);
  });
});

describe('buildMemoryGraph', () => {
  const memos = [
    { name: 'alpha', type: 'project', body: 'links [[beta]] and [[ghost]] and [[ ]]' },
    { name: 'beta', type: 'feedback', body: 'back to [[alpha]]; self [[beta]] ignored' },
  ];
  const g = buildMemoryGraph(memos);

  it('creates a node per memory with type', () => {
    expect(g.nodes.find((n) => n.id === 'alpha')).toMatchObject({ type: 'project', missing: false });
    expect(g.nodes.find((n) => n.id === 'beta')).toMatchObject({ type: 'feedback', missing: false });
  });

  it('adds a stub (missing) node for a dangling link target', () => {
    expect(g.nodes.find((n) => n.id === 'ghost')).toMatchObject({ missing: true });
  });

  it('creates LINKS_TO edges and flags dangling ones', () => {
    expect(g.edges).toContainEqual({ type: 'LINKS_TO', from: { label: 'Memory', id: 'alpha' }, to: { label: 'Memory', id: 'beta' }, dangling: false });
    expect(g.edges).toContainEqual({ type: 'LINKS_TO', from: { label: 'Memory', id: 'alpha' }, to: { label: 'Memory', id: 'ghost' }, dangling: true });
  });

  it('ignores self-links', () => {
    expect(g.edges.some((e) => e.from.id === 'beta' && e.to.id === 'beta')).toBe(false);
  });

  it('is stable on rebuild (no duplicate edges)', () => {
    expect(buildMemoryGraph(memos).edges).toHaveLength(g.edges.length);
  });
});
