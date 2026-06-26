/**
 * Code-structure graph builder (issue #63) — the GraphRAG graph pillar's code corpus.
 *
 * Parses the TypeScript source with ts-morph and produces nodes + edges for the
 * Apache AGE `capy_kg` graph (#62):
 *   - File   { id: <relpath>, layer, lang }   — id == the `path` of rag_embeddings
 *             source_ids, so a vector hit can hop to its file node (#66).
 *   - Symbol { id: "<relpath>#<Name>", name, kind, path, layer }
 *   - Layer  { name }
 * Edges: (Symbol)-[:DEFINED_IN]->(File), (File)-[:IN_LAYER]->(Layer),
 *        (File)-[:IMPORTS]->(File), (Symbol)-[:DEPENDS_ON]->(Symbol).
 *
 * Pure (no DB): returns a plain object so it can be unit-tested. The DB upsert
 * lives in db.mjs (upsertCodeGraph).
 */
import { relative } from 'node:path';
import { Project } from 'ts-morph';

/** Map a repo-relative path to its Clean Architecture layer. */
export function layerOf(relPath) {
  if (/^src\/app\/core\/domain\//.test(relPath)) return 'domain';
  if (/^src\/app\/core\/application\//.test(relPath)) return 'application';
  if (/^src\/app\/core\/infrastructure\//.test(relPath)) return 'infrastructure';
  if (/^src\/app\/core\/presentation\//.test(relPath)) return 'presentation';
  if (/^src\/app\/features\//.test(relPath)) return 'feature';
  if (/^src\/app\/shared\//.test(relPath)) return 'shared';
  if (/^src\/app\/agents\//.test(relPath)) return 'agents';
  return 'other';
}

/** Classify a symbol by path (primary) — useCase / repository / interface / entity / … */
export function kindOf(relPath) {
  if (/\.use-case\.ts$/.test(relPath)) return 'useCase';
  if (/\.repository\.interface\.ts$/.test(relPath)) return 'interface';
  if (/repositories\//.test(relPath) || /\.repository\.ts$/.test(relPath)) return 'repository';
  if (/core\/domain\/entities\//.test(relPath) || /\.entity\.ts$/.test(relPath) || /\.builder\.ts$/.test(relPath))
    return 'entity';
  if (/\.facade\.ts$/.test(relPath)) return 'facade';
  if (/\.component\.ts$/.test(relPath)) return 'component';
  if (/\.service\.ts$/.test(relPath)) return 'service';
  if (/\.interface\.ts$/.test(relPath)) return 'interface';
  return 'other';
}

function isIndexableSource(relPath) {
  if (!/^src\//.test(relPath)) return false;
  if (/\.spec\.ts$/.test(relPath)) return false;
  if (/\.stories\.ts$/.test(relPath)) return false;
  if (/^src\/stories\//.test(relPath)) return false;
  return /\.ts$/.test(relPath);
}

/**
 * @param {string} root repo root (defaults to cwd)
 * @returns {{files: object[], symbols: object[], layers: string[], edges: object[]}}
 */
export function buildCodeGraph(root = process.cwd()) {
  const project = new Project({
    tsConfigFilePath: `${root}/tsconfig.json`,
    skipAddingFilesFromTsConfig: true,
  });
  project.addSourceFilesAtPaths(`${root}/src/**/*.ts`);

  const files = [];
  const symbols = [];
  const layers = new Set();
  const edgeSet = new Map(); // signature -> edge object (dedupe)

  const rel = (sf) => relative(root, sf.getFilePath()).split('\\').join('/');
  const addEdge = (type, fromLabel, fromId, toLabel, toId) => {
    const sig = `${type}|${fromLabel}:${fromId}|${toLabel}:${toId}`;
    if (!edgeSet.has(sig)) {
      edgeSet.set(sig, { type, from: { label: fromLabel, id: fromId }, to: { label: toLabel, id: toId } });
    }
  };

  // First pass: index the source files we care about.
  const sources = project.getSourceFiles().filter((sf) => isIndexableSource(rel(sf)));
  const indexed = new Set(sources.map((sf) => rel(sf)));

  for (const sf of sources) {
    const relPath = rel(sf);
    const layer = layerOf(relPath);
    layers.add(layer);
    files.push({ id: relPath, layer, lang: 'ts' });
    addEdge('IN_LAYER', 'File', relPath, 'Layer', layer);

    // Exported classes + interfaces become Symbol nodes.
    const decls = [
      ...sf.getClasses().filter((c) => c.isExported() && c.getName()),
      ...sf.getInterfaces().filter((i) => i.isExported() && i.getName()),
    ];
    const localSymbolIds = [];
    for (const d of decls) {
      const name = d.getName();
      const id = `${relPath}#${name}`;
      symbols.push({ id, name, kind: kindOf(relPath), path: relPath, layer });
      addEdge('DEFINED_IN', 'Symbol', id, 'File', relPath);
      localSymbolIds.push(id);
    }

    // Imports → File IMPORTS File and Symbol DEPENDS_ON Symbol (named imports).
    for (const imp of sf.getImportDeclarations()) {
      const target = imp.getModuleSpecifierSourceFile();
      if (!target) continue; // external / unresolved
      const targetRel = rel(target);
      if (!indexed.has(targetRel)) continue; // node_modules / non-indexed
      addEdge('IMPORTS', 'File', relPath, 'File', targetRel);
      for (const named of imp.getNamedImports()) {
        const targetSymId = `${targetRel}#${named.getName()}`;
        for (const fromId of localSymbolIds) {
          addEdge('DEPENDS_ON', 'Symbol', fromId, 'Symbol', targetSymId);
        }
      }
    }
  }

  return { files, symbols, layers: [...layers], edges: [...edgeSet.values()] };
}
