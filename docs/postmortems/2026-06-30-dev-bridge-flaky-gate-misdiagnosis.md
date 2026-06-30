# Postmortem + Premortem — Dev bridge misdiagnosed a flaky pre-push gate

- **Date:** 2026-06-30
- **Severity:** Medium (no production impact; one autonomous job stranded, ~34 min + 3 wasted push attempts, 2 junk commits)
- **Status:** Recovered (PR #122, story #43) + bridge guardrails proposed below
- **Author:** Engineering
- **Related:** dev-bridge job `6lxsw`, [[2026-06-26-product-load-crash]] (the #109 contract gate this flake attacks)

---

## Part 1 — Postmortem (what happened)

### Summary

The dev bridge (`~/n8n-local/dev-bridge`) ran job `6lxsw` ("start the work on
next important item"), correctly implemented **Story #43 — multi-tenant
membership & isolation**, then hit a pre-push gate rejection. Its self-repair
loop **misdiagnosed the rejection as a coverage shortfall**, made two commits
adding tests that didn't address the real cause, exhausted all 3 push attempts,
and ended `gate-failed` with the branch stranded and no PR.

The real cause was a **flaky test-isolation defect**, not coverage.

### Timeline

- `8ec5ebe9` — bridge implements #43 (auth services, DTOs, specs). Sound work.
- Push attempt 1 → pre-push gate rejects.
- `1a1de295` — repair attempt 1: adds a spec for `angular-authorization.service.ts` ("restore coverage gate").
- Push attempt 2 → rejected.
- `9553e85a` — repair attempt 2: adds 2 `current-user.service` branch tests.
- Push attempt 3 → rejected → `JOB 6lxsw GATE-FAILED (2039s)`. Branch kept, no PR.

### Root cause

Two layers — a real test bug, and a bridge that couldn't see it.

1. **The test bug (the flake).** `pos-terminal.component.spec.ts`'s
   `mockProductRepository` was missing `findActive`. The spec renders the
   **real** `<app-product-search>` child, whose `ngOnInit →
   ProductService.getActiveProducts() → repository.findActive()` therefore
   rejected in all 41 tests, leaking async `console.error("Failed to load
   products")` **across spec boundaries**. Under `--coverage` (which the gate
   uses) the slower timing let a leaked error intermittently land inside the
   **#109 contract gate**'s window, tripping
   `expect(errorSpy).not.toHaveBeenCalled()`. Result: a gate that passes on a
   plain re-run but fails nondeterministically at push.

2. **The bridge couldn't diagnose it.** Three design choices combined:
   - **The self-repair prompt leads with coverage.** `runClaudeFix` opens with
     "The gate runs unit tests with a 90% coverage threshold…" and lists "add
     the missing coverage" first. With a razor-thin 90.17% margin in the diff,
     the agent anchored on coverage and never suspected a flake.
   - **Gate output is truncated to the last 6 KB and unfiltered.** The actual
     `FAIL …contract.spec.ts` line and the 49 `findActive is not a function`
     errors scrolled off behind intentional console noise (retry/telemetry
     logs), so the agent's "failure output" was mostly noise.
   - **No determinism check.** The loop retries the *push* but never re-runs the
     gate to ask "is this outcome stable?" A flaky gate is indistinguishable
     from a real failure, and each attempt commits a blind
     `fix: resolve pre-push gate failure (attempt N)` whether or not it helped.

### Resolution

Stubbed `findActive` on the pos-terminal mock so the child loads cleanly
(`90c85a18`). Leaked errors: **49/run → 0**. Verified deterministic: full
`--coverage` suite ×6 all EXIT 0 (1989 passed); affected e2e 156 passed; the
real pre-push hook passed on `git push`. PR #122 opened, `Closes #43`.

### What went right

- The bridge's **worktree isolation** meant the stranded branch was clean and
  trivially recoverable.
- It **kept the branch** on failure instead of discarding — the work survived.
- Its final (un-acted-on) reasoning *had* spotted the `findActive` error; the
  signal existed, the loop just ended before using it.

---

## Part 2 — Premortem (how the next run fails if we change nothing)

> Imagine the next `!build` job has failed. Why?

- **It hits another flake and burns 3 attempts + junk commits again.** Most
  likely repeat. The coverage-anchored prompt and noise-truncated output are
  unchanged, so any timing/order-dependent gate failure replays this exact loop.
- **It "fixes" a flake by luck.** A flaky gate passes on attempt 2 by chance;
  the bridge declares success and opens a PR over a latent race that resurfaces
  in CI for a human.
- **It weakens the gate to get green.** Under pressure to pass, an agent lowers
  a threshold, adds `--no-verify`, or `.skip`s the failing test. The prompt
  forbids this, but nothing *enforces* it — a post-repair diff check would.
- **A junk `fix:` commit lands in the PR.** The two coverage commits here were
  harmless, but a blind "make the gate pass" commit can mask rather than fix.

### Guardrails for the next run (proposed `server.mjs` changes)

1. **Probe for flakiness before repairing.** On first gate rejection, re-run the
   gate locally **twice more** in the worktree. If outcomes differ → label
   `flaky`, and switch the repair prompt to *"this gate is nondeterministic;
   find the source of cross-test state/async leakage (unhandled rejection,
   undestroyed fixture, incomplete mock, shared singleton), not coverage."*
2. **Extract signal, don't truncate.** Before calling the agent, grep the gate
   log for `FAIL `, `✗`, `is not a function`, `Coverage … does not meet`,
   `runWithTimeout` and hand the agent that **structured digest** plus the tail —
   not just the last 6 KB. Explicitly tag intentional console noise as noise.
3. **De-bias the prompt.** Lead with "diagnose the *category* first: (a) real
   test failure, (b) coverage shortfall, (c) flaky/isolation, (d) lint/Sonar"
   and require the agent to state the category before fixing. Coverage is one of
   four, not the headline.
4. **Verify the fix locally before spending a push attempt.** After each repair,
   run the gate command in-worktree (ideally 2×) and only `git push` when it's
   green and stable. Saves attempts and avoids "push to find out."
5. **Block gate-weakening.** After repair, diff against the pre-repair tree; if
   it touches coverage thresholds, `.husky/*`, adds `--no-verify`/`.skip`/`.only`,
   or deletes tests → reject the repair and flag for human review.
6. **Don't commit empty/no-op repairs.** Only create the `fix:` commit if the
   repair actually changed files *and* moved the gate outcome; otherwise abort
   to `gate-failed` faster with the diagnosis attached.
7. **Cap by signal, not just count.** If two consecutive attempts produce the
   same failure with no progress, stop early and post the diagnosis rather than
   burning the third attempt.

### How we'd know it worked

- Flaky-gate jobs end in minutes with a *named root cause*, not 34 min of churn.
- Zero `fix: resolve pre-push gate failure (attempt N)` commits that don't change
  the outcome.
- No PRs merged over a gate that only passed once.
```
Made with Bob
```
