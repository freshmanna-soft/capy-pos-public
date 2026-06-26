# 🎉 100 Pull Requests — Capy-POS

> Commemorating PR #100. Fittingly, the milestone is narrated by the **GraphRAG
> knowledge layer** that was designed and built across this stretch — it reads
> its own stats out of the store it lives in. Run it yourself:
>
> ```bash
> RAG_DB_URL=… npm run graphrag:celebrate
> ```

```
            ____
         .-"    "-.
        /          \        ~ Capy-POS ~
       |   ^    ^   |      100 pull requests
       |    (  )    |        and counting
        \   '--'   /
         '-.____.-'
        /  |    |  \
       (__/      \__)   stay chill, ship often

  ── milestone, as told by the GraphRAG store it built ──

   vector chunks indexed : 1549
   graph nodes           : 196 files · 335 symbols · 52 issues · 22 memories
   epics tracked         : 27
   stories that built me : 16 (epic #55, Phases 1–4)

   most depended-on symbols (per the code graph):
     • IBaseAgent — 43 dependents
     • Product — 32 dependents
     • Customer — 26 dependents

   one Postgres, two pillars (pgvector + Apache AGE), ~86% fewer tokens/task.
   thanks for 100. 🦫💚
```

## The arc to 100

- **GraphRAG knowledge layer (epic #55, Phases 1–4)** — one Postgres holding a
  pgvector corpus + an Apache AGE graph (code / issues / memory), self-updating
  (incremental reindex + webhook trigger), and consumable by a shared HTTP
  endpoint, an MCP server, and a universal client. **~86% fewer tokens per task.**
- **A green, trustworthy e2e suite** — 42 deterministic failures root-caused and
  repaired; the affected-Playwright check made a required gate.
- **Real CI** — fast PR gates (lint · unit+coverage · build) plus affected e2e,
  with infra-as-code for the store.

Onward. 🦫
