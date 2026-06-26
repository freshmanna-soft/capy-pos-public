import { describe, expect, it } from 'vitest';
import { chunkFile } from './chunker.mjs';

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

describe('chunkFile', () => {
  it('returns no chunks for empty / whitespace-only content', () => {
    expect(chunkFile('')).toEqual([]);
    expect(chunkFile('   \n\n  ')).toEqual([]);
  });

  it('keeps a small file as a single chunk with full line range', () => {
    const out = chunkFile(lines(5));
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ startLine: 1, endLine: 5 });
    expect(out[0].text).toBe(lines(5));
  });

  it('splits only on line boundaries — every chunk line is a whole source line', () => {
    const src = lines(500);
    const srcLines = src.split('\n');
    for (const c of chunkFile(src, { maxChars: 200, overlapLines: 3 })) {
      for (const l of c.text.split('\n')) {
        expect(srcLines).toContain(l); // never a partial line / mid-token split
      }
    }
  });

  it('produces overlapping, monotonically advancing ranges', () => {
    const out = chunkFile(lines(500), { maxChars: 200, overlapLines: 3 });
    expect(out.length).toBeGreaterThan(1);
    for (let i = 1; i < out.length; i += 1) {
      expect(out[i].startLine).toBeGreaterThan(out[i - 1].startLine); // forward progress
      expect(out[i].startLine).toBeLessThanOrEqual(out[i - 1].endLine + 1); // contiguous or overlapping
    }
    // last chunk reaches end of file
    expect(out.at(-1).endLine).toBe(500);
  });

  it('always emits at least one line even when a single line exceeds maxChars', () => {
    const long = 'x'.repeat(5000);
    const out = chunkFile(`${long}\nshort`, { maxChars: 100 });
    expect(out[0].text).toContain(long); // not truncated mid-line
  });
});
