import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const { runCheckoutReconciliationJob } = await import('./checkout-reconciliation-job.ts');
process.env.NODE_ENV = ORIGINAL_NODE_ENV;

const T0 = '2026-09-18T12:00:00.000Z';

function job(options = {}) {
  const logs = [];
  const failures = [];
  const dueCalls = [];
  const reconciled = [];
  const outcomes = new Map(options.outcomes ?? []);
  let id = 0;
  const deps = {
    buildRuntime() {
      return {
        dueCheckouts: {
          async listDue(input) {
            dueCalls.push(input);
            return {
              checkouts: options.checkouts ?? [],
              nextCursor: null,
            };
          },
        },
        service: {
          async reconcile(checkoutId, lease) {
            reconciled.push([checkoutId, lease]);
            const outcome = outcomes.get(checkoutId);
            if (outcome instanceof Error) throw outcome;
            return outcome ?? { outcome: 'reconciled', status: {} };
          },
        },
      };
    },
    nowIso: () => T0,
    monotonicNowMs: () => 0,
    newId: () => `id-${++id}`,
    log: (message, details) => logs.push([message, details]),
    reportFailure: (failure) => failures.push(failure),
  };
  return { deps, logs, failures, dueCalls, reconciled };
}

describe('checkout reconciliation job', () => {
  it('applies bounded environment settings and emits a safe summary', async () => {
    const ctx = job({ checkouts: [{ id: 'checkout-1' }] });

    await runCheckoutReconciliationJob(
      {
        CHECKOUT_WORKER_MAX_CHECKOUTS: '2',
        CHECKOUT_WORKER_PAGE_SIZE: '1',
        CHECKOUT_WORKER_MAX_DURATION_MS: '1000',
      },
      ctx.deps
    );

    assert.deepEqual(ctx.dueCalls, [{ asOf: T0, limit: 1, cursor: undefined }]);
    assert.deepEqual(ctx.reconciled, [
      ['checkout-1', { ownerId: 'checkout-worker:id-1', leaseId: 'id-2' }],
    ]);
    assert.deepEqual(ctx.logs, [
      [
        '[pos-api] checkout reconciliation complete',
        {
          asOf: T0,
          attempted: 1,
          reconciled: 1,
          busy: 0,
          failed: 0,
          failureReportsDropped: 0,
          exhausted: false,
          exhaustionReason: null,
        },
      ],
    ]);
  });

  it('reports only checkout id and error class, then fails the job run', async () => {
    const secretBearingMessage = 'provider failed with secret-value';
    const ctx = job({
      checkouts: [{ id: 'checkout-1' }],
      outcomes: [['checkout-1', new TypeError(secretBearingMessage)]],
    });

    await assert.rejects(
      runCheckoutReconciliationJob({}, ctx.deps),
      /completed with isolated failures/
    );

    assert.deepEqual(ctx.failures, [{ checkoutId: 'checkout-1', error: 'TypeError' }]);
    assert.doesNotMatch(JSON.stringify(ctx.failures), /secret-value/);
  });

  it('rejects invalid worker limits before querying', async () => {
    const ctx = job();

    await assert.rejects(
      runCheckoutReconciliationJob({ CHECKOUT_WORKER_PAGE_SIZE: '101' }, ctx.deps),
      /CHECKOUT_WORKER_PAGE_SIZE/
    );

    assert.equal(ctx.dueCalls.length, 0);
  });
});
