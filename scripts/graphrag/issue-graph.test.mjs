import { describe, expect, it } from 'vitest';
import { buildIssueGraph } from './issue-graph.mjs';

const ISSUES = [
  { number: 55, title: 'Epic: Shared GraphRAG Layer', state: 'OPEN', body: 'Overview\n- [ ] #62 — bootstrap\n- [x] #63 — code graph' },
  { number: 62, title: 'Story: Enable AGE', state: 'CLOSED', body: '**Part of #55** · Size: S\nblocked by #99\nblocks #64' },
  { number: 64, title: 'Story: Issue graph', state: 'OPEN', body: '**Part of #55** · build order 3' },
];

describe('buildIssueGraph', () => {
  const g = buildIssueGraph(ISSUES);

  it('creates a node per issue with number/title/state/isEpic', () => {
    expect(g.nodes).toHaveLength(3);
    const epic = g.nodes.find((n) => n.id === '55');
    expect(epic).toMatchObject({ number: 55, isEpic: true, state: 'open' });
    expect(g.nodes.find((n) => n.id === '62')).toMatchObject({ isEpic: false, state: 'closed' });
  });

  it('captures PART_OF (story → epic)', () => {
    expect(g.edges).toContainEqual({ type: 'PART_OF', from: { label: 'Issue', id: '62' }, to: { label: 'Issue', id: '55' } });
    expect(g.edges).toContainEqual({ type: 'PART_OF', from: { label: 'Issue', id: '64' }, to: { label: 'Issue', id: '55' } });
  });

  it('captures HAS_TASK from the epic checklist (only to fetched issues)', () => {
    // Epic #55's checklist references #62 (fetched) and #63 (not in fixture).
    expect(g.edges).toContainEqual({ type: 'HAS_TASK', from: { label: 'Issue', id: '55' }, to: { label: 'Issue', id: '62' } });
    expect(g.edges.some((e) => e.type === 'HAS_TASK' && e.to.id === '63')).toBe(false);
  });

  it('captures BLOCKS but drops edges to unknown issues (#99 not fetched)', () => {
    expect(g.edges).toContainEqual({ type: 'BLOCKS', from: { label: 'Issue', id: '62' }, to: { label: 'Issue', id: '64' } });
    // #99 is referenced via "blocked by" but is not a fetched node → no edge.
    expect(g.edges.some((e) => e.to.id === '99')).toBe(false);
  });

  it('does not duplicate edges on rebuild', () => {
    const again = buildIssueGraph(ISSUES);
    expect(again.edges).toHaveLength(g.edges.length);
  });
});
