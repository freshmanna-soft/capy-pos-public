#!/usr/bin/env node
/**
 * Affected Playwright runner (Option A — deterministic, no GenAI).
 *
 * Selects which e2e specs to run based on the files changed vs the base branch,
 * then runs them on a single browser project (chromium by default).
 *
 * Selection policy (combined floor + affected + full-fallback):
 *   - persona-workflows.spec.ts ALWAYS runs (navigation-integrity floor).
 *   - Feature changes ADD their mapped specs on top.
 *   - Core / shared / config / unknown source changes ESCALATE to the full suite.
 *   - Docs / stories / unit-test-only changes SKIP e2e entirely.
 *
 * Env / flags:
 *   AFFECTED_BASE      base ref to diff against (default: origin/main)
 *   PLAYWRIGHT_PROJECT browser project to run    (default: chromium)
 *   --list | AFFECTED_DRY=1   print the decision and exit without running Playwright
 *
 * Exit code mirrors Playwright (so it works as a husky gate). Skip/dry exit 0.
 */
import { execFileSync, spawnSync } from 'node:child_process';

const E2E_DIR = 'tests/e2e';
const FLOOR_SPEC = `${E2E_DIR}/persona-workflows.spec.ts`;
const BASE = process.env.AFFECTED_BASE || 'origin/main';
const PROJECT = process.env.PLAYWRIGHT_PROJECT || 'chromium';
const DRY = process.argv.includes('--list') || process.env.AFFECTED_DRY === '1';

/** Run a git command, returning trimmed stdout or '' on failure. */
function git(args) {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

/** Resolve the diff base: merge-base(BASE, HEAD), else HEAD~1, else '' (=> full). */
function resolveDiffBase() {
  if (git(['rev-parse', '--verify', '--quiet', BASE])) {
    const mb = git(['merge-base', BASE, 'HEAD']);
    if (mb) return { ref: mb, label: `merge-base ${BASE}…HEAD` };
  }
  if (git(['rev-parse', '--verify', '--quiet', 'HEAD~1'])) {
    return { ref: 'HEAD~1', label: 'HEAD~1…HEAD (no origin/main)' };
  }
  return { ref: '', label: '(no base available)' };
}

function changedFiles(baseRef) {
  if (!baseRef) return null; // signal: cannot determine -> caller escalates to full
  const out = git(['diff', '--name-only', baseRef, 'HEAD']);
  return out ? out.split('\n').filter(Boolean) : [];
}

// FULL-suite triggers: high blast-radius / cross-cutting changes.
const FULL_PATTERNS = [
  /^src\/app\/core\//,
  /^src\/app\/shared\//,
  /^src\/app\/app\.routes\.ts$/,
  /^src\/app\/app\.component\./,
  /^src\/app\/app\.config\./,
  /^src\/main\.ts$/,
  /^src\/styles\.scss$/,
  /^src\/index\.html$/,
  /^src\/404\.html$/,
  /^src\/environments\//,
  /^package(-lock)?\.json$/,
  /^angular\.json$/,
  /^tsconfig.*\.json$/,
  /^playwright\.config\.ts$/,
];

// SKIP class: inert files that cannot change app runtime behavior, so they
// never require e2e — regardless of which directory they live in. Evaluated
// before FULL/feature rules so a unit test or story under core/ still skips.
// (Changed e2e specs under tests/e2e/ are handled earlier and run themselves;
// any non-spec file under tests/e2e/ falls through to the safe FULL default.)
const SKIP_PATTERNS = [
  /\.md$/,
  /^docs\//,
  /^\.github\//,
  /^\.claude\//,
  /^infra\//, // infra-as-code (Docker/compose/SQL/env) — no Angular runtime impact
  /^scripts\//, // build/dev tooling (this runner, graphrag) — not bundled into the app
  /^LICENSE$/,
  /^src\/stories\//,
  /\.stories\.ts$/,
  /^src\/.*\.spec\.ts$/, // co-located unit tests
  /^tests\/(?!e2e\/)/, // cucumber / non-e2e test assets
  /\.feature$/,
];

// Feature directory -> e2e specs. Order matters: more specific paths first.
const FEATURE_MAP = [
  {
    re: /^src\/app\/features\/pos-terminal\/components\/transaction-history\//,
    specs: ['transaction-history.spec.ts'],
  },
  { re: /^src\/app\/features\/pos-terminal\//, specs: ['pos-terminal.spec.ts'] },
  {
    re: /^src\/app\/features\/inventory-management\//,
    specs: [
      'inventory-management.spec.ts',
      's4-5-inventory-customer-workflows.spec.ts',
      'low-stock-alerts.spec.ts',
    ],
  },
  {
    re: /^src\/app\/features\/customers\//,
    specs: ['customer-management.spec.ts', 's4-5-inventory-customer-workflows.spec.ts'],
  },
  {
    re: /^src\/app\/features\/dashboard\//,
    specs: ['low-stock-alerts.spec.ts', 'agent-integration.spec.ts'],
  },
  { re: /^src\/app\/features\/settings\//, specs: ['low-stock-alerts.spec.ts'] },
  {
    re: /^src\/app\/features\/login\//,
    specs: ['app.spec.ts', 'persona-workflows.spec.ts'],
  },
  { re: /^src\/app\/features\/reports\//, specs: [] }, // covered by the floor
  {
    re: /^src\/app\/agents\//,
    specs: ['agent-integration.spec.ts', 'pos-terminal.spec.ts'],
  },
];

/** Classify one file. Returns {full?, specs?, skip?, unknown?}. First match wins. */
function classify(file) {
  // 1. A changed e2e spec runs itself (before the generic tests/ skip).
  const m = /^tests\/e2e\/(.+\.spec\.ts)$/.exec(file);
  if (m) return { specs: [m[1]] };
  // 2. Inert files (tests/stories/docs) never need e2e, wherever they live.
  if (SKIP_PATTERNS.some((re) => re.test(file))) return { skip: true };
  // 3. High blast-radius source -> full suite.
  if (FULL_PATTERNS.some((re) => re.test(file))) return { full: true };
  // 4. Feature directory -> mapped specs.
  for (const { re, specs } of FEATURE_MAP) {
    if (re.test(file)) return { specs };
  }
  return { unknown: true }; // unmapped source -> safe escalation to full
}

function decide(files) {
  if (files === null) {
    return { mode: 'full', reason: 'could not determine diff base' };
  }
  if (files.length === 0) {
    return { mode: 'skip', reason: 'no changed files in range' };
  }
  const selected = new Set();
  let sawNonSkip = false;
  const fullReasons = [];

  for (const f of files) {
    const c = classify(f);
    if (c.full) {
      sawNonSkip = true;
      fullReasons.push(f);
    } else if (c.unknown) {
      sawNonSkip = true;
      fullReasons.push(`${f} (unmapped source)`);
    } else if (c.specs) {
      sawNonSkip = true;
      c.specs.forEach((s) => selected.add(s));
    } // skip -> contributes nothing
  }

  if (fullReasons.length > 0) {
    return { mode: 'full', reason: `high blast-radius change: ${fullReasons[0]}` };
  }
  if (!sawNonSkip) {
    return { mode: 'skip', reason: 'all changed files are non-impacting (docs/stories/unit)' };
  }
  // Floor + affected.
  selected.add('persona-workflows.spec.ts');
  const specs = [...selected].sort((a, b) => a.localeCompare(b)).map((s) => `${E2E_DIR}/${s}`);
  return { mode: 'affected', specs };
}

function main() {
  const base = resolveDiffBase();
  const files = changedFiles(base.ref);
  const decision = decide(files);

  console.log('🎯 Affected Playwright selection');
  console.log(`   base:    ${base.label}`);
  console.log(`   changed: ${files === null ? '?' : files.length} file(s)`);
  console.log(`   project: ${PROJECT}`);

  if (decision.mode === 'skip') {
    console.log(`   decision: SKIP e2e — ${decision.reason}`);
    process.exit(0);
  }

  let specArgs;
  if (decision.mode === 'full') {
    console.log(`   decision: FULL suite — ${decision.reason}`);
    specArgs = []; // no filter => all specs
  } else {
    console.log(`   decision: AFFECTED (${decision.specs.length} spec[s], incl. floor):`);
    decision.specs.forEach((s) => console.log(`     - ${s}`));
    specArgs = decision.specs;
  }

  if (DRY) {
    console.log('   (--list) dry run — not invoking Playwright.');
    process.exit(0);
  }

  const args = ['playwright', 'test', ...specArgs, `--project=${PROJECT}`, '--reporter=list'];
  console.log(`\n▶ npx ${args.join(' ')}\n`);
  const res = spawnSync('npx', args, { stdio: 'inherit' });
  process.exit(res.status ?? 1);
}

main();
