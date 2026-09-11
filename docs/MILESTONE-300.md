# 🎉 PR #300 — Capy-POS

> [`MILESTONE-100.md`](./MILESTONE-100.md) was narrated by a single system: the
> **GraphRAG** store read its own stats out of itself, because at #100 it was the
> thing that had just been built.
>
> By #300 there is no single narrator to ask. So everyone came. Run it yourself:
>
> ```bash
> RAG_DB_URL=… npm run milestone:celebrate
> ```

```
        ____                ____                ____
     .-"    "-.          .-"    "-.          .-"    "-.
    /          \        /          \        /          \
   |   ^    ^   |      |   ^    ^   |      |   ^    ^   |
   |    (  )    |      |    (  )    |      |    (  )    |
    \   '--'   /        \   '--'   /        \   '--'   /
     '-.____.-'          '-.____.-'          '-.____.-'
     /  |   |  \         /  |   |  \         /  |   |  \
    (__/     \__)       (__/     \__)       (__/     \__)
       the till            the clerk           the bridge

                    ~ Capy-POS · PR #300 ~
              one of us shipped it, all of us built it

  ── #300, as told by everyone who showed up ──

   git             335 commits on main, first one 2026-05-26
   github          171 pull requests, 166 merged
                   of those, 35 were opened by the bridge itself
   dev-bridge      80 build jobs run, driving claude-opus-5
                   reviewers ride claude-sonnet-5, three per pull request
   graphrag        3098 vector chunks, 268 files, 465 symbols
                   41 memories kept, so none of this had to be re-learned
                   most depended-on: IBaseAgent (43), Product (40), Customer (26)
   the suite       152 unit spec files, 12 Playwright specs
                   coverage floor 90%, and it has never been lowered to pass
   the estate      5 containerised services, deployed on IBM Cloud
                   staff and customers now split across two App ID applications

   #100 was narrated by one system. #300 needed a guest list.
   stay chill, ship often. 🦫💚
```

Every line above is read live at run time. Nothing is hardcoded, and a guest that
cannot be reached prints `— not reachable from here` rather than contributing a
plausible number. A party where someone is absent should look like someone is absent.

## The arc from 100 to 300

- **Off one laptop and onto a cloud.** Five containerised services on IBM Cloud
  Code Engine — the app, `pos-api`, `vision-proxy`, `clerk-agent-relay`,
  `appid-token-relay` — with Terraform holding the estate and revision-level
  verification, not just a green `apply`. AWS was retired rather than left to rot.
- **Real identity.** Staff auth moved off local-only credentials onto IBM App ID
  with RS256 verification across every service. The bug that stretch is remembered
  for: App ID's JWKS encodes its RSA modulus with a non-minimal leading zero byte,
  which a real browser's WebCrypto rejects and Node's polyfill happily accepts — so
  it was invisible to the entire unit suite and would have blocked every sign-in.
- **One source of truth for permissions.** Three hand-copied role tables collapsed
  into a single shared Cloudant document, fetched through a TTL cache that keeps
  serving the last good answer rather than silently narrowing permissions to nothing.
- **A till that watches, and a clerk that talks.** `/clerk` and the vision path,
  with a frame gate in front of the model because the interesting problem was never
  recognition — it was not paying for sixteen inferences of the same jar.
- **A build pipeline that argues with itself.** The dev-bridge grew a weighted
  three-persona review quorum where one verified defect vetoes two approvals, a
  self-repair loop, and a guardrail that reverts any diff which tries to delete a
  test or weaken a gate to get green. It has caught that exact attempt more than once.
- **Customers of its own.** Epic #261 reached 13 of 25 items: a parallel customer
  identity that cannot borrow a staff session, a self-checkout lane reachable
  without a login, and an App ID tenant now split into two applications so a
  customer token is refused by the staff gateway on audience alone.

## What #300 actually was

Fittingly ordinary, and exactly on theme: **item 13 of Epic #261** — binding the
customer auth gateway to the self-checkout lazy route and nowhere else.

Its interesting half was not the wiring. The customer adapter had been importing
its config from the *staff* adapter, so the self-checkout bundle would have dragged
the whole staff adapter in behind it — route-scoped binding, but not a route-scoped
bundle. Neither the compiler nor a DI test can see that: an injector has no opinion
about which module a token was imported from, and the re-export left behind keeps
compiling forever.

So #300 shipped a test that walks the static import graph and asserts what the
customer adapter must never reach. The 300th pull request is a guard against a
boundary quietly coming undone — which is about as good a description of the
previous 299 as anything.

Onward. 🦫
