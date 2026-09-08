# Spike — converting `package-lock.json` to `pnpm-lock.yaml` under pnpm's isolated layout

- **Date:** 2026-09-08
- **Status:** Done — migration is safe to proceed, after the one fix landed here
- **Author:** Engineering (Epic #289 item 1, issue #291)
- **Related:** #289 (pnpm migration epic), #288 (hardened base images),
  `scripts/graphrag/code-graph.mjs`

## What was run

A throwaway copy of the worktree (`/tmp/pnpm-spike`, no `.git`/`node_modules`) was converted with
`pnpm import`, installed with `pnpm install --ignore-scripts` (matching CI's
`npm ci --ignore-scripts`), and put through the gate. pnpm 11.5.2, Node 26.

`pnpm import` reproduced the tree exactly — **1695 resolutions**, no version drift from
`package-lock.json`.

| Gate step                     | Result                                                |
| ----------------------------- | ----------------------------------------------------- |
| `format:check`                | pass                                                  |
| `lint` (`ng lint`)            | pass                                                  |
| `tsc --noEmit`                | pass                                                  |
| `test:unit -- --coverage`     | pass — 146 files, 3868 tests, coverage thresholds met |
| `build` (Angular prod bundle) | pass — bundle generated, exit 0                       |
| `test:graphrag`               | **FAIL** — see below                                  |

## The one real break: `ts-morph` was a phantom dependency

`scripts/graphrag/code-graph.mjs:17` does `import { Project } from 'ts-morph'`, but `ts-morph` was
never declared in `package.json`. npm hoisted `ts-morph@27.0.2` to top-level `node_modules/` as a
transitive dependency, so the import resolved by accident. pnpm's isolated layout does not hoist it,
so:

```
FAIL  scripts/graphrag/code-graph.test.mjs
Error: Cannot find package 'ts-morph' imported from .../scripts/graphrag/code-graph.mjs
```

This is not a pnpm bug — it is exactly the class of latent defect the migration was expected to
surface. It was already a live risk under npm: nothing pinned that hoisted copy, so any dependency
bump that dropped or renested `ts-morph` would have broken `test:graphrag` (a CI job,
`.github/workflows/ci.yml:75`) and `graphrag:reindex` with no warning.

**Fix (landed in this commit):** `ts-morph` is now a direct `devDependency` at `^27.0.2` — the
version npm was already hoisting, so `package-lock.json` changed by exactly one line (the
declaration edge) with zero resolved-version churn. `test:graphrag` then passes under pnpm: 12
files, 63 tests.

No other undeclared import exists in `src/`, `tests/`, `scripts/`, or `.storybook/` — a scan of
every import specifier against the declared dependency set found only `ts-morph` plus the tsconfig
path aliases (`@core/*`, `@features/*`, `@shared/ui`), which resolve through `tsconfig.json`, not
`node_modules`.

## Note for item 2 (`packageManager` flip)

pnpm 11 refuses to run at all while `packageManager` says `npm@…`:

```
[ERROR] This project is configured to use npm
```

Neither `.npmrc` (`package-manager-strict=false`) nor `pnpm-workspace.yaml`
(`packageManagerStrict: false`) suppressed this on 11.5.2 — the only thing that worked was setting
the field to `pnpm@11.5.2`. So item 2's `packageManager` edit is not cosmetic and not independently
landable: it must go in the same commit as `pnpm-lock.yaml`, or the repo is briefly unusable by
either package manager.

## Verdict

Green light for #289 items 2-7. Per this item's scope, the throwaway `pnpm-lock.yaml` was **not**
committed and `package-lock.json` was **not** deleted — that is item 2. The only change taken from
this spike is the `ts-morph` declaration, which is correct on its own merits under npm today.
