/**
 * GitHub issue graph builder (issue #64) — adds the :Issue subgraph to capy_kg.
 *
 * Pure: `buildIssueGraph(issues)` takes the array returned by
 *   gh issue list --json number,title,state,body
 * and produces { nodes, edges } for the AGE graph. Edges are parsed from issue
 * body text (this repo's convention), since GitHub-native dependencies aren't
 * used here:
 *   - PART_OF      from "Part of #<n>"            (story -> epic)
 *   - HAS_TASK     from epic checklists "- [ ] #<n>" / "- [x] #<n>"
 *   - BLOCKS       from "blocks #<n>"
 *   - BLOCKED_BY   from "blocked by #<n>"
 * Edges are only emitted when the target issue is also a fetched node.
 */

function isEpicTitle(title) {
  return /^(Epic:|Master Epic:)/.test(title ?? '');
}

/**
 * @param {{number:number, title:string, state:string, body?:string}[]} issues
 * @returns {{nodes: object[], edges: object[]}}
 */
export function buildIssueGraph(issues) {
  const nodes = [];
  const known = new Set();
  for (const it of issues) {
    const id = String(it.number);
    known.add(id);
    nodes.push({
      id,
      number: it.number,
      title: it.title ?? '',
      state: (it.state ?? '').toLowerCase(),
      isEpic: isEpicTitle(it.title),
    });
  }

  const edgeSet = new Map();
  const addEdge = (type, fromId, toId) => {
    if (!known.has(toId) || fromId === toId) return; // skip dangling / self
    const sig = `${type}|${fromId}|${toId}`;
    if (!edgeSet.has(sig)) edgeSet.set(sig, { type, from: { label: 'Issue', id: fromId }, to: { label: 'Issue', id: toId } });
  };

  const matchAll = (text, re) => [...(text ?? '').matchAll(re)].map((m) => m[1]);

  for (const it of issues) {
    const from = String(it.number);
    const body = it.body ?? '';
    for (const n of matchAll(body, /Part of #(\d+)/gi)) addEdge('PART_OF', from, n);
    for (const n of matchAll(body, /- \[[ xX]\] #(\d+)/g)) addEdge('HAS_TASK', from, n);
    for (const n of matchAll(body, /blocked by #(\d+)/gi)) addEdge('BLOCKED_BY', from, n);
    for (const n of matchAll(body, /(?:^|\s)blocks #(\d+)/gi)) addEdge('BLOCKS', from, n);
  }

  return { nodes, edges: [...edgeSet.values()] };
}
