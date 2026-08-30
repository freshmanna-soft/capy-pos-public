# Spike — two competing sync-backend strategies both landed on `main`

- **Date:** 2026-08-30
- **Status:** Open — needs a decision, not yet a bug
- **Author:** Engineering (found while merging #221)
- **Related:** #206, #195, #196, #197, PR #220, PR #221

## Context

Issue #206 established that `terraform/aws-demo`'s API Gateway was gone (DNS no
longer resolves) and, even when it existed, had no authorizer at all — a fully
public write API for products/transactions. Its scope listed two possible ways
forward: re-stand the AWS stack with a real authorizer, or the already-tracked
IBM-migration epic (#195/#196/#197).

Both were worked on in parallel and both landed on `main`, in this order:

1. **PR #220** (closing #206), final commit `5b63279c` "apply review feedback
   (POS-206)" — adds `apiServiceToken` to every `environment.*.ts`, a shared
   `Authorization: Bearer <token>` sent by `sync.worker.ts` when set, matched by
   a Lambda authorizer added to `terraform/aws-demo`. This is the
   **re-stand-AWS-with-auth** strategy. Left `apiServiceToken: ''` on purpose in
   `environment.prod.ts` — "the token would be public with extra steps" — so in
   prod today this sends no `Authorization` header at all.
2. **PR #221**, merged on top of #220 — repoints `apiUrl`/`visionApiUrl`/
   `clerkAgentApiUrl` in `environment.prod.ts` at the IBM Code Engine estate
   (`capy-pos-api`, `capy-vision-proxy`, `capy-clerk-agent-relay`) and turns
   `aiVision`/`clerkAgent` on. This is the **migrate-to-IBM** strategy.

Because the two PRs touched different lines of the same file, they merged
cleanly with no conflict — and no one decision point where a human had to pick
one strategy over the other.

## Current state (not yet broken, but inconsistent)

`src/environments/environment.prod.ts` right now:

- `apiUrl` → IBM `capy-pos-api` (Code Engine), verified live.
- `apiServiceToken` → `''`, with a comment describing `terraform/aws-demo`'s
  Bearer-token scheme, which `infra/pos-api` does not implement — pos-api
  verifies a session JWT instead (`infra/pos-api/src/session-auth.ts`), a
  different mechanism entirely.

Nothing is broken today only because `apiServiceToken` is empty, so
`sync.worker.ts` sends no `Authorization` header, and IBM's `pos-api` doesn't
require one by that name. But the code now describes an auth story that does
not match where it points, and `terraform/aws-demo`'s Lambda authorizer
(added by PR #220) has no live caller — the AWS stack has not been reapplied
(`terraform/aws-demo/terraform.tfstate` still reads empty per #206), so that
work is stranded unless someone reapplies it or removes it.

## Decision needed

Pick one sync-backend strategy, not both:

- **A. Commit to IBM** (what's actually live and reachable today). Remove
  `apiServiceToken` and the Bearer-token plumbing from `sync.worker.ts`/
  `sync.types.ts`/every `environment.*.ts`, and close out the AWS-authorizer
  side of #206 as superseded rather than done. `terraform/aws-demo` stays
  dormant/reference-only, matching `terraform/README.md`'s own framing of it.
- **B. Commit to re-standing AWS** with the new authorizer, and revert PR
  #221's `apiUrl`/`visionApiUrl`/`clerkAgentApiUrl` changes in
  `environment.prod.ts`. Vision/clerk-agent would need their own path onto
  AWS (they only exist on IBM Code Engine right now).
- **C. Run both**, deliberately, if there's a real reason (e.g. AWS for
  products/transactions sync, IBM for the AI clerk only) — in which case the
  `apiServiceToken` comment should say so explicitly instead of describing a
  single backend, and `pos-api`'s session-JWT auth and AWS's Bearer-token auth
  need to be reconciled, not run as two silent, unrelated schemes.

## Non-goals of this spike

Not picking a side. This is a record of the conflict so it gets a deliberate
decision instead of staying two half-finished strategies that happened not to
textually conflict in `git merge`.
