# Capy-POS UX Overhaul — Resume Notes

**Status as of 2026-09-16**: Plan approved, execution not yet started. Paused before Phase 0.

Full plan (authoritative): `/Users/javierbritopacheco/.claude/plans/cheeky-imagining-conway.md`

## Task tracker state (7 tasks created, all pending, none started)

| # | Phase | Subject |
|---|-------|---------|
| 1 | 0 | Sync local main to origin/main |
| 2 | 1 | Routing/shell restructure |
| 3 | 2 | Design-token consolidation |
| 4 | 4 | Self-checkout sign-in (Epic #261 item 18) |
| 5 | 5 | Bridge App ID identity to domain Customer/loyalty |
| 6 | 6 | PayPal pay step |
| 7 | 3 | Shared components + screen retrofit (last) |

Execution order: **0 → 1 → 2 → 4 → 5 → 6 → 3** (Phase 3's visual retrofit is deliberately last, after the new sign-in/pay components from 4–6 exist, so shared components get applied once, not twice).

## One-paragraph context

capy-pos's local checkout was 27 commits behind `origin/main` — those 27 commits are almost entirely "Epic #261," a fully-built but unsynced customer self-checkout feature (`/self-checkout`, App ID customer auth, sign-up form) already sharing `/clerk`'s design language. The plan is not "build kiosk mode from scratch" — it's sync in what exists, fix the structural nav bug (`app.html` unconditionally renders the side nav — no layout component), consolidate the design system around the existing "Onsen Counter" palette (yuzu accent, Heroicons), and complete three genuinely missing pieces: customer sign-in (gateway already built, just needs a route+component), bridging the App ID auth identity to the domain `Customer`/loyalty entity (issue #218), and a new PayPal pay step (explicitly deferred/undecided in the existing code's own comments). User confirmed PayPal over the pre-provisioned-but-unused Stripe config.

## Immediate next step on resume

**Phase 0**: `EnterWorktree` (per persistent "always use worktrees for capy-pos" rule) → stash the 3 locally-modified files (`.env.production`, `.env.staging`, `.storybook/main.ts`) → `git merge --ff-only origin/main` → `npm ci && npm run build` → run self-checkout specs → confirm they pass. Note: an environment check this session reported "Is a git repository: false" for `/Users/javierbritopacheco/codebase/capy-pos` — re-verify `git status`/`git rev-parse` at resume time before assuming the earlier 27-commits-behind analysis still holds.

## Key facts to not re-derive

- Passkey support for customers: **does not exist, never did** — staff-only on every branch. User's "we used to have passkey support" referred to real staff passkeys, unrelated to the real hidden customer signup, both cited as examples of the app being "dispersed."
- `CustomerAuthGateway.authenticate()`/`CurrentCustomerService.setSession()`/`redirectIfAuthenticatedGuard` are already fully implemented on origin/main.
- `Customer` records are Dexie-local/per-terminal, not synced — flagged as an accepted risk for a single-terminal pilot, not silently resolved.
- `checkout.component.ts` has a pre-existing `PaymentMethod`/`PaymentResult` type collision (local type shadows the domain type) — Phase 6 fixes this while adding `'paypal'`.
- Full detail, file paths, and verification steps: see the plan file linked above.
