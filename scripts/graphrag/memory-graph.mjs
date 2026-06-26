/**
 * claude-mem memory link graph builder (issue #65) — adds the :Memory subgraph.
 *
 * Pure: `buildMemoryGraph(memos)` takes parsed memory files
 *   [{ name, type, body }]
 * and produces { nodes, edges }:
 *   - Memory { id: <name slug>, type, missing }   (missing=true for stub nodes
 *     that are only referenced by a dangling [[link]], never defined)
 *   - (Memory)-[:LINKS_TO { dangling }]->(Memory)  one per `[[target]]` link
 *     (dangling=true when the target isn't a real memory file).
 */

/** Extract trimmed, non-empty [[link]] targets from text. */
export function extractLinks(text) {
  const out = [];
  for (const m of (text ?? '').matchAll(/\[\[([^\]]+)\]\]/g)) {
    const t = m[1].trim();
    if (t) out.push(t);
  }
  return out;
}

/**
 * @param {{name:string, type?:string, body:string}[]} memos
 * @returns {{nodes: object[], edges: object[]}}
 */
export function buildMemoryGraph(memos) {
  const known = new Set(memos.map((m) => m.name));
  const nodes = memos.map((m) => ({ id: m.name, type: m.type ?? '', missing: false }));
  const stubIds = new Set();
  const edgeSet = new Map();

  for (const m of memos) {
    for (const target of extractLinks(m.body)) {
      if (target === m.name) continue; // ignore self-links
      const dangling = !known.has(target);
      if (dangling && !stubIds.has(target)) {
        stubIds.add(target);
        nodes.push({ id: target, type: '', missing: true });
      }
      const sig = `${m.name}|${target}`;
      if (!edgeSet.has(sig)) {
        edgeSet.set(sig, { type: 'LINKS_TO', from: { label: 'Memory', id: m.name }, to: { label: 'Memory', id: target }, dangling });
      }
    }
  }

  return { nodes, edges: [...edgeSet.values()] };
}
