import { describe, expect, it } from 'vitest';
import { parseNameStatus } from './git-diff.mjs';

describe('parseNameStatus', () => {
  it('splits added/modified vs deleted', () => {
    const out = ['M\tsrc/a.ts', 'A\tsrc/b.ts', 'D\tsrc/c.ts'].join('\n');
    expect(parseNameStatus(out)).toEqual({ modified: ['src/a.ts', 'src/b.ts'], deleted: ['src/c.ts'] });
  });

  it('treats a rename as new-modified + old-deleted', () => {
    const out = 'R100\tsrc/old.ts\tsrc/new.ts';
    expect(parseNameStatus(out)).toEqual({ modified: ['src/new.ts'], deleted: ['src/old.ts'] });
  });

  it('treats a copy as new-modified only', () => {
    const out = 'C100\tsrc/orig.ts\tsrc/copy.ts';
    expect(parseNameStatus(out)).toEqual({ modified: ['src/copy.ts'], deleted: [] });
  });

  it('ignores blank lines and empty input', () => {
    expect(parseNameStatus('')).toEqual({ modified: [], deleted: [] });
    expect(parseNameStatus('\n\n')).toEqual({ modified: [], deleted: [] });
  });
});
