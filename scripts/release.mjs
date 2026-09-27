#!/usr/bin/env node
/**
 * scripts/release.mjs
 *
 * Auto-tags a new release from the latest git tag and pushes it to origin,
 * triggering the deploy-ibm.yml workflow.
 *
 * Usage:
 *   node scripts/release.mjs           # patch bump  (v1.0.0 → v1.0.1)
 *   node scripts/release.mjs patch     # patch bump
 *   node scripts/release.mjs minor     # minor bump  (v1.0.0 → v1.1.0)
 *   node scripts/release.mjs major     # major bump  (v1.0.0 → v2.0.0)
 *   node scripts/release.mjs --dry-run # print the next tag without creating it
 *
 * npm script shortcut (add to package.json):
 *   "release":       "node scripts/release.mjs"
 *   "release:minor": "node scripts/release.mjs minor"
 *   "release:major": "node scripts/release.mjs major"
 */

import { execSync } from 'node:child_process';

// ── Args ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const bumpArg = args.find((a) => ['patch', 'minor', 'major'].includes(a)) ?? 'patch';

// ── Helpers ───────────────────────────────────────────────────────────────────

function run(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function bump(version, type) {
  // Strip leading 'v', split on '-' to ignore pre-release suffixes for
  // arithmetic, then re-apply a clean semver string.
  const core = version.replace(/^v/, '').split('-')[0];
  const [major, minor, patch] = core.split('.').map(Number);
  switch (type) {
    case 'major': return `v${major + 1}.0.0`;
    case 'minor': return `v${major}.${minor + 1}.0`;
    case 'patch': return `v${major}.${minor}.${patch + 1}`;
  }
}

// ── Guards ────────────────────────────────────────────────────────────────────

// Must be on main and up to date before tagging.
const branch = run('git rev-parse --abbrev-ref HEAD');
if (branch !== 'main') {
  console.error(`❌  You are on '${branch}'. Switch to main before releasing.`);
  process.exit(1);
}

run('git fetch origin --tags --quiet');

const localSha  = run('git rev-parse HEAD');
const remoteSha = run('git rev-parse origin/main');
if (localSha !== remoteSha) {
  console.error('❌  Local main is not in sync with origin/main. Pull first.');
  process.exit(1);
}

// Check for uncommitted changes.
const status = run('git status --porcelain');
if (status) {
  console.error('❌  Working tree has uncommitted changes. Commit or stash them first.');
  process.exit(1);
}

// ── Compute next tag ──────────────────────────────────────────────────────────

// Latest semver tag; fall back to v0.0.0 if the repo has no tags yet.
let latest;
try {
  latest = run('git tag --sort=-v:refname --list "v*"').split('\n')[0] || 'v0.0.0';
} catch {
  latest = 'v0.0.0';
}

const next = bump(latest, bumpArg);

console.log(`  current : ${latest}`);
console.log(`  bump    : ${bumpArg}`);
console.log(`  next    : ${next}`);

if (dryRun) {
  console.log('\n--dry-run: no tag created.');
  process.exit(0);
}

// ── Tag and push ──────────────────────────────────────────────────────────────

run(`git tag ${next}`);
console.log(`\n✅  Tagged ${next}`);

run(`git push origin ${next}`);
console.log(`🚀  Pushed ${next} → origin`);
console.log(`\n   GitHub Actions will now build and deploy all services.`);
console.log(`   Watch progress at: https://github.com/freshmanna-soft/capy-pos-public/actions`);
