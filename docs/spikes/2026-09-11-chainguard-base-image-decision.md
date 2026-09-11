# Spike — Chainguard/hardened base images: what the free tier actually ships, and what we pin to

- **Date:** 2026-09-11
- **Status:** Done — **decision made: keep Alpine, pin it, and add a CVE scanner in CI. Do not adopt
  Chainguard's free tier now.** Items 2–6 of the epic need re-scoping (see "What this means for
  items 2–7").
- **Author:** Engineering (Epic #288 item 1)
- **Related:** #288 (this epic), #289 (pnpm migration), `docs/INFRASTRUCTURE_GUIDE.md`,
  `src/app/core/infrastructure/deployment/base-image-policy.spec.ts`

No Dockerfile is changed by this item. The deliverable is the decision plus the evidence it rests
on, and one guard test that keeps the decision enforceable once items 2–6 start editing `FROM`
lines.

## What was actually pulled and inspected

Host: macOS/arm64, Colima, Docker 29.5.2. Every number below came from a real `docker pull` /
`docker run` on 2026-09-11, not from documentation.

Both free-tier tags pulled successfully, anonymously, with no Chainguard account:

| Reference                             | Pull   | Digest (as resolved 2026-09-11) | Size (arm64) |
| ------------------------------------- | ------ | ------------------------------- | ------------ |
| `cgr.dev/chainguard/node:latest-dev`  | **ok** | `sha256:9df8062d1bc926d…beaf9e` | 276.5 MB     |
| `cgr.dev/chainguard/node:latest`      | **ok** | `sha256:4a274a26acabd96…30cd87` | 62.6 MB      |
| `cgr.dev/chainguard/nginx:latest`     | **ok** | `sha256:7b3bbe97d6ba4be…d9e691` | 6.5 MB       |
| `cgr.dev/chainguard/node:22` (pinned) | **no** | —                               | —            |

`cgr.dev/chainguard/node:22` fails as **`not found`**, not `unauthorized`:

```
Error response from daemon: failed to resolve reference "cgr.dev/chainguard/node:22":
cgr.dev/chainguard/node:22: not found
```

That confirms the epic's 2026-09-08 premise, and sharpens it: the version-pinned tag is not merely
gated behind a login we could add — it is absent from the catalog we can see at all. There is no
credential we hold that turns it into a pullable tag.

### `node:latest-dev` — shell, npm, and Node **26**

```
node -v   → v26.8.2
npm -v    → 12.0.2
/etc/os-release → ID=wolfi, NAME="Wolfi"
id        → uid=65532(node) gid=65532(node)
present   → /usr/bin/sh, /usr/bin/bash, /usr/bin/busybox, /usr/bin/apk
```

Full shell, package manager, npm. Usable as a build stage as the epic expected.

### `node:latest` — **not distroless**: it has a shell, busybox, and npm

This is the finding that changes the decision. The epic budgeted time for rewriting `CMD` to exec
form because the runtime variant would have "little or no shell, no package manager". Measured:

```
node -v → v26.8.2      npm -v → 12.0.2
sh      = /usr/bin/sh          npx     = /usr/bin/npx
busybox = /usr/bin/busybox     ls      = /usr/bin/ls
bash    = ABSENT               cat     = /usr/bin/cat
apk     = ABSENT
Entrypoint = ["/usr/bin/node"]   Cmd = ["--help"]   User = 65532
```

So the runtime image keeps a POSIX shell, a full busybox applet set, and npm/npx. What it drops
versus Alpine is `apk` (no package manager) and `bash`. That is a real reduction, but it is much
smaller than "distroless": a shell and a package-installer-capable npm both survive into the runtime
layer, which are the two things the epic's Context named as the attack surface to remove.

It is also **not smaller than what we run today**: `cgr.dev/chainguard/node:latest` is 62.6 MB
against `node:22-alpine`'s 58.1 MB on the same host. The swap costs ~4 MB.

### The Node major is 26 today, and we deploy 22

Every service currently builds and runs on `node:22-alpine` (`infra/appid-token-relay`,
`infra/vision-proxy`, `infra/clerk-agent-relay`, `infra/pos-api`, and the root `Dockerfile`'s build
stage). The only Node the free tier serves is **26.8.2**. Adopting Chainguard free is therefore not
a base-image swap, it is a **four-major Node upgrade** to a runtime we have never validated in
production, bundled into a change we would describe in the PR as "hardening". Those are two changes
that should not ride together.

### `nginx:latest` is the genuinely attractive one

```
nginx version: nginx/1.31.5   Size = 6.5 MB   User = 65532   Entrypoint = ["/usr/sbin/nginx"]
```

6.5 MB and non-root by default, against `nginx:alpine`'s root-by-default. If any part of this epic
is worth doing on the free tier, it is the serve stage of the root `Dockerfile` — but it inherits
the same floating-tag problem, and 1.31.x is a moving target on every rebuild.

## The decision

**Option D: keep the Alpine bases, pin them, and add a container CVE scanner (Trivy) to CI. Do not
change any base image in this epic.**

Reasoning, against the three options the epic listed:

**Immutable digest pin — rejected, and it is worse than it looks.** It buys reproducibility, and on
a normal registry it would be the obvious answer. Here the digest we would pin is a _build of a
rolling tag on a free tier_. Chainguard's free offering is documented as serving the current
`latest` build; nothing commits it to serving yesterday's digest, so a pinned digest can stop being
pullable and break every build that references it, with no upstream signal and no fallback tag to
degrade to. It also freezes us on Node 26.8.2 — a version we have not qualified — and the "bump it
deliberately" workflow means a human re-resolving a digest by hand on a schedule, which is exactly
the patching discipline we do not have today. If we ever do take this route, the missing piece is a
**mirror**: re-tag the resolved digest into our own `us.icr.io` namespace (we already push every
service image there) so retention is ours, not the free tier's. That mirror is the prerequisite, not
an optimisation.

**Floating `latest` — rejected.** It auto-patches, but it hands an unannounced Node major bump to
any rebuild, including a rebuild triggered by an unrelated hotfix. For 5 services deployed to Code
Engine, "the runtime changed major version because we rebuilt on a Tuesday" is a worse failure mode
than an unpatched base image we know about and scan.

**Alpine + scanner — chosen.** It is the option whose cost/benefit the measurements actually
support:

- The security delta we would be buying is `apk` and `bash` leaving the runtime layer — _not_ the
  shell and _not_ npm, both of which `chainguard/node:latest` keeps. Meaningful, but not the
  step-change the epic assumed.
- We keep `node:22-alpine` — a version-pinned, retained, mirror-able tag from a registry that keeps
  history — so builds stay reproducible and the Node major stays a deliberate decision.
- The gap Chainguard was meant to close (nobody is looking at our base-image CVEs) is closed
  directly and more cheaply by scanning, which also covers our _own_ dependency tree, which no base
  image swap ever would.
- It is reversible. Nothing here forecloses Chainguard: if a paid plan lands, or a free pinnable tag
  appears, the scanner stays useful and the Dockerfiles are untouched.

**Revisit trigger** — reopen this decision if any of: (a) a version-pinned `cgr.dev/chainguard/node`
tag becomes pullable without a paid plan; (b) we take a paid Chainguard plan for other reasons; (c)
we upgrade the fleet to Node 26 for independent reasons, which removes the major-version objection
and leaves only the retention one (solvable by the ICR mirror above); or (d) the CI scanner starts
reporting fixable HIGH/CRITICAL findings in `node:22-alpine` that Alpine upstream is not patching.

**Not chosen, for the record:** `gcr.io/distroless/nodejs22` is genuinely pinnable and free and was
the closest runner-up, but it ships no shell and no npm, so the runtime stages that currently do
`npm ci --omit=dev` (see `infra/appid-token-relay/Dockerfile`) would all have to be restructured to
copy a pre-built `node_modules` from the build stage. That is a real migration, worth its own epic
if we want distroless — it is not the "same shape each time" swap items 2–6 were written as. Wolfi
direct (via `apko`/`melange`) means owning image builds ourselves; too much surface for the benefit.

## What this means for items 2–7

Items 2–6 were written as `FROM node:22-alpine` → `FROM cgr.dev/chainguard/node:…` swaps, one
service at a time. Under this decision **none of them should be done as written.** Proposed
re-scope, to be applied to the epic when this lands:

1. **Items 2–6 → closed as not-required** (base images stay). The per-service verification steps
   they carried (buildx `--platform linux/amd64`, container starts, health endpoint responds) are
   still valuable and are not lost — they belong to whatever change next touches these Dockerfiles.
2. **New item: add Trivy image scanning to `.github/workflows/ci.yml`** — scan the built images for
   OS + dependency CVEs, `--severity HIGH,CRITICAL`, `--ignore-unfixed`, non-blocking on first
   landing so we learn the real baseline before we gate on it. This is the work that delivers the
   epic's actual goal and is the natural next item.
3. **New item (optional, small): `chainguard/nginx:latest` for the serve stage only**, mirrored to
   `us.icr.io` by digest. 6.5 MB and non-root are a real win, the serve stage has no npm to lose,
   and nginx 1.31 vs Alpine's nginx is not a four-major runtime jump. Lower risk than the Node half
   and separable from it.
4. **Item 7 (rollout) → not required** while no image changes.
5. **Out of scope, unchanged:** `infra/graphrag/Dockerfile`.

## Guard landed with this decision

`src/app/core/infrastructure/deployment/base-image-policy.spec.ts` reads every container build file
in the repo and asserts what this decision concluded, so the next person editing a `FROM` line has
to agree with it or change it deliberately:

- `unpinned` — every `FROM` carries a tag or a complete 64-character digest; a bare image name, or a
  truncated digest that would not pull, is a violation;
- `floating-tag` — `latest`, `edge`, `main`, `stable` and the whole `latest-*` family (`latest-dev`,
  `latest-alpine`, `latest-22`) are rejected. This is the finding above turned into a rule, and it
  is the one that catches a well-meaning `FROM cgr.dev/chainguard/node:latest` — asserted directly,
  by name, in _requires a cgr.dev base to be digest-pinned_;
- `unversioned-tag` — the tag must identify a release: a digit, or a known distro codename
  (`bookworm`, `noble`, …), since `debian:bookworm` is as precise a pin as `node:22`. The one
  exception is the recorded `VARIANT_TAG_ALLOWLIST`;
- `unpinned-cgr-dev` — if a `cgr.dev/…` base ever appears it must be digest-pinned, since a version
  tag there cannot be pulled at all on the free tier.

Tags are compared case-insensitively. `FROM`, `AS` and filename matching already were, and reading
tags exact-case while reading everything else case-insensitively left a hole shaped exactly like
`node:LATEST-22` — which the floating rule missed on case and the digit rule missed on the `22`.

The spec deliberately does not hardcode `node:22-alpine`: items that legitimately bump the Node
major should not have to edit a policy test to do it.

Discovery is a basename match (`Dockerfile`, `Dockerfile.<suffix>`, `<name>.dockerfile`,
`Containerfile`), not a `git ls-files -- '*Dockerfile'` pathspec. A pathspec only matches paths that
_end_ in `Dockerfile`, so a `Dockerfile.dev` added next to an existing service would be built by CI
and skipped by the policy — a floating base could then land in the one file nobody was checking.
`.dockerignore` and `docker-compose.yml` are not build files and are excluded, and so is a
`Dockerfile.<suffix>` whose suffix makes it prose or config (`Dockerfile.md`, `Dockerfile.yml`) —
otherwise a design note one character away from `Dockerfile.dev` gets scanned for `FROM` lines and
reported as a policy violation.

The spec has two layers, because **the repo cannot prove the policy it complies with.** Every rule
written only as `expect(scan.filter(…)).toEqual([])` is a rule you can delete with the suite still
green: the repo's bases are `node:22-alpine`, `nginx:alpine` and `pgvector/pgvector:pg16`, so
nothing in it floats, nothing is bare, and nothing comes from `cgr.dev`. Same for the parser — no
Dockerfile here uses `FROM --platform=…`, a digest pin, a `host:port/` registry or `FROM <stage>`.

So the rules are named predicates in a `POLICY_RULES` table, applied by `policyViolations()`, and
each one is proven by synthetic references that _do_ violate it. The repo scan then asserts one
thing: today's Dockerfiles produce no violations.

Verified by mutation, 22 mutants, all killed: emptying `FLOATING_TAGS`, `RELEASE_CODENAME_TAGS` or
`VARIANT_TAG_ALLOWLIST`; dropping any one of the four rules; dropping the `latest-*` prefix match,
any tag case-normalization, the codename allowance, the allowlist check, or the Docker Hub prefix
normalization; and dropping any parser or discovery guard (the digest split, the registry-port
check, the `--flag` filter, the stage-name filter, the empty-token guard, the digest-length anchor,
the basename pattern, the non-build-suffix rejection). One caveat worth recording, because it bit
this spec twice: a test that loops over the constant it is checking
(`for (const tag of FLOATING_TAGS) …`) passes vacuously the moment the constant is emptied, which is
the exact mutation it was written to catch. The tag literals are spelled out for that reason.

One thing writing the guard surfaced: **`nginx:alpine` floats too.** It carries no version, so the
root `Dockerfile`'s serve stage already takes whatever nginx Docker Hub last built on Alpine — the
exact failure mode this decision rejects Chainguard's `latest` for. It is not changed here (item 1
changes no Dockerfile) and is recorded in the spec's `VARIANT_TAG_ALLOWLIST` so it is visible and
countable rather than silently tolerated. Re-scope item 3 above is the fix, and it is now the
best-justified piece of remaining work in this epic.
