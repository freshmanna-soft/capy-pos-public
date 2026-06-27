# Postmortem — "Product name is required" crashed every product view

- **Date:** 2026-06-26
- **Severity:** High (multiple views unusable)
- **Status:** Fixed (resilient repository mapping) + follow-up hardening tracked
- **Author:** Engineering

## Summary

A single malformed product record caused **every view that loads products** —
POS product search, Inventory, and the dashboard low-stock widget — to fail with:

```
Failed to load products: Error: Product name is required
  validate → (Product factory) → build → map → loadProducts
```

The product catalog could not render at all. The data corruption originates from
a backend/sync returning a product with an empty `name` (the capy-pos-demo
**failure-injection** mode deliberately returns HTTP 200 with corrupted product
data; such a record can also reach IndexedDB via a bad sync or seed).

## Impact

- POS terminal product search: blank / error — cashiers cannot add items.
- Inventory management list: failed to load.
- Dashboard low-stock widget: failed to load.
- A **single** bad record took down the **entire** catalog for all consumers.

## Root cause

Two correct-in-isolation decisions combined into a fragile whole:

1. **Strict entity validation.** `Product`'s constructor calls `validate()` and
   throws on an empty name. This is the right guard for *writes*.
2. **All-or-nothing list mapping.** Every repository list method mapped rows with
   `records.map((r) => this.mapToEntity(r))`. Because `mapToEntity` constructs a
   `Product` (which validates), **one** throwing record aborted the **whole**
   `map`, so the entire `findActive()` / `search()` / `findLowStock()` call
   rejected — not just the bad row.

The result: a data-quality problem in one row became a total outage of the
feature, instead of a single missing item.

## Why every gate missed it

| Gate | Why it passed |
|------|---------------|
| **Unit tests** | The Dexie repositories had **no unit tests** for the mapping path. Everything upstream mocks the repository with clean, valid data, so a malformed record never flowed through the real `mapToEntity`. |
| **E2E (Playwright)** | Runs against clean seed data. The corrupt-data / failure-injection path is never exercised — tests assert the happy path (search → add → checkout) only. |
| **Build / Lint** | Static analysis cannot catch a runtime data-shape contract violation. |
| **90% coverage gate** | False confidence: high line/branch coverage measures *code executed by happy-path tests*, not *scenarios exercised*. The resilience branch didn't exist, so there was nothing to leave uncovered. |

**The systemic lesson:** we only test with well-formed data. We had a chaos tool
(failure-injection) that simulates exactly this, but **no test consumed it**. Our
gates proved the happy path works; they never proved the app degrades gracefully
when an upstream returns bad data.

## Fix

Make list mapping resilient at the repository seam
(`BaseDexieRepository.mapRecords`): map each record in a `try/catch`, **skip**
invalid records with a `console.warn`, and return the valid ones. One corrupt row
now produces one missing item + a warning, not a feature outage.

- Single-record getters (`findById`, `findOneBy…`) intentionally keep throwing —
  a direct lookup of a known-bad record should surface the error to the caller.
- Applied to all `BaseDexieRepository` list methods and the
  `DexieProductRepository` overrides (`findActive`, `search`, `findLowStock`).

Regression coverage added in `base-dexie.repository.spec.ts` (skips invalid,
keeps valid, never throws, warns appropriately).

## Action items (learn & adapt)

- [x] Resilient `mapRecords` in `BaseDexieRepository` + product repo list methods.
- [x] Unit regression test for the resilient mapping.
- [ ] **Chaos/contract test gate:** an integration test that loads a collection
      containing a malformed record and asserts graceful degradation (tracked).
- [ ] **Repository test floor:** require unit coverage for repository mapping
      (negative path included) so untested data seams can't ship (tracked).
- [ ] **Surface skipped records:** emit a telemetry counter when records are
      skipped, shown on the agent-monitor dashboard, so silent data corruption is
      visible in ops (tracked).

## Principle

Trust boundaries (API responses, synced data, persisted rows) must be parsed
defensively at the boundary. A malformed item is a **data** problem; it must not
become a **control-flow** problem that crashes unrelated, valid data.
