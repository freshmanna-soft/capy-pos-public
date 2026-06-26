/**
 * Line-aware chunker for the codebase corpus (issue #58).
 *
 * Splits source text into overlapping windows on LINE boundaries only — a chunk
 * never starts or ends mid-line (hence never mid-token). Each chunk carries its
 * 1-based inclusive line range so the indexer can build a canonical id and the
 * graph pillar / self-updating loop (Phase 2/3) can reference the same spans.
 *
 * Symbol-aware (tree-sitter) splitting is a deliberate later enhancement; this
 * fixed-size line window is the Phase 1 baseline.
 */

/**
 * @param {string} content
 * @param {{maxChars?: number, overlapLines?: number}} [opts]
 * @returns {{startLine: number, endLine: number, text: string}[]} 1-based inclusive ranges
 */
export function chunkFile(content, { maxChars = 1500, overlapLines = 8 } = {}) {
  if (typeof content !== 'string' || content.trim().length === 0) return [];

  const lines = content.split('\n');
  const chunks = [];
  let start = 0; // 0-based index of first line in the current window

  while (start < lines.length) {
    let end = start; // 0-based exclusive end
    let size = 0;
    // Always take at least one line; otherwise stop before exceeding maxChars.
    while (end < lines.length) {
      const lineLen = lines[end].length + 1; // + newline
      if (end > start && size + lineLen > maxChars) break;
      size += lineLen;
      end += 1;
    }

    const text = lines.slice(start, end).join('\n');
    if (text.trim().length > 0) {
      chunks.push({ startLine: start + 1, endLine: end, text });
    }

    if (end >= lines.length) break;

    // Advance, keeping `overlapLines` of context; guarantee forward progress.
    const next = end - overlapLines;
    start = next > start ? next : end;
  }

  return chunks;
}
