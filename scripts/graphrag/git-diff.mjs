/**
 * Git diff helpers for incremental reindexing (issue #79).
 * `parseNameStatus` is pure (testable); the others shell out to git.
 */
import { execFileSync } from 'node:child_process';

/**
 * Parse `git diff --name-status <a> <b>` output into changed/removed paths.
 * Renames (R) and copies (C) count the new path as modified; a rename's old
 * path is treated as deleted so its stale rows are removed.
 * @param {string} out
 * @returns {{modified: string[], deleted: string[]}}
 */
export function parseNameStatus(out) {
  const modified = [];
  const deleted = [];
  for (const line of (out ?? '').split('\n')) {
    if (!line.trim()) continue;
    const parts = line.split('\t');
    const code = parts[0][0];
    if (code === 'D') {
      deleted.push(parts[1]);
    } else if (code === 'R' || code === 'C') {
      // R/C lines: <status>\t<old>\t<new>
      if (code === 'R') deleted.push(parts[1]);
      modified.push(parts[2]);
    } else if (code === 'A' || code === 'M') {
      modified.push(parts[1]);
    }
  }
  return { modified, deleted };
}

export function headSha(root = process.cwd()) {
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
}

export function changedFilesSince(sha, root = process.cwd()) {
  const out = execFileSync('git', ['diff', '--name-status', sha, 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });
  return parseNameStatus(out);
}
