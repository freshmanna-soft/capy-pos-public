import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const { runLoyaltyReconciliationJob } = await import('./loyalty-reconciliation-job.ts');
process.env.NODE_ENV = ORIGINAL_NODE_ENV;

const T0 = '2027-01-15T10:00:00.000Z';

function setup({ outcome = { outcome: 'awarded' }, fail = false } = {}) {
  const logs = [];
  const reports = [];
  const calls = [];
  let ids = 0;
  const dueCheckouts = {
    listDueLoyalty: async () => ({ checkouts: [{ id: 'checkout-1' }], nextCursor: null }),
  };
  const reconciler = {
    reconcile: async (checkoutId, lease) => {
      calls.push([checkoutId, lease]);
      if (fail) throw new Error('isolated');
      return outcome;
    },
  };
  const deps = {
    buildRuntime: () => ({ dueCheckouts, reconciler }),
    nowIso: () => T0,
    monotonicNowMs: () => 0,
    newId: () => `id-${++ids}`,
    log: (message, details) => logs.push([message, details]),
    reportFailure: (failure) => reports.push(failure),
  };
  return { deps, logs, reports, calls };
}

describe('loyalty reconciliation job', () => {
  it('uses its own environment limits and non-PII worker lease ids', async () => {
    const ctx = setup();
    await runLoyaltyReconciliationJob(
      {
        LOYALTY_WORKER_MAX_CHECKOUTS: '1',
        LOYALTY_WORKER_PAGE_SIZE: '1',
        LOYALTY_WORKER_MAX_DURATION_MS: '1000',
      },
      ctx.deps
    );
    assert.deepEqual(ctx.calls, [
      ['checkout-1', { ownerId: 'loyalty-worker:id-1', leaseId: 'id-2' }],
    ]);
    assert.equal(ctx.logs[0][0], '[pos-api] loyalty reconciliation complete');
    assert.equal(ctx.logs[0][1].awarded, 1);
  });

  it('reports only checkout id and error class before failing the invocation', async () => {
    const ctx = setup({ fail: true });
    await assert.rejects(
      runLoyaltyReconciliationJob({}, ctx.deps),
      /completed with isolated failures/
    );
    assert.deepEqual(ctx.reports, [{ checkoutId: 'checkout-1', error: 'Error' }]);
  });

  it('refuses invalid unbounded environment values before paging', async () => {
    const ctx = setup();
    await assert.rejects(
      runLoyaltyReconciliationJob({ LOYALTY_WORKER_PAGE_SIZE: '101' }, ctx.deps),
      /LOYALTY_WORKER_PAGE_SIZE/
    );
    assert.equal(ctx.calls.length, 0);
  });
});
