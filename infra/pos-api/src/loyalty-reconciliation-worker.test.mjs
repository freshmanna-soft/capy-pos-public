import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LoyaltyReconciliationWorker } from './loyalty-reconciliation-worker.ts';

const T0 = '2027-01-15T10:00:00.000Z';

function setup(options = {}) {
  const pages = [...(options.pages ?? [{ checkouts: [], nextCursor: null }])];
  const outcomes = new Map(options.outcomes ?? []);
  const dueCalls = [];
  const reconcileCalls = [];
  const reports = [];
  const times = [...(options.times ?? [0])];
  let last = times[0] ?? 0;
  let id = 0;
  const worker = new LoyaltyReconciliationWorker({
    dueCheckouts: {
      listDueLoyalty: async (input) => {
        dueCalls.push(input);
        return pages.shift() ?? { checkouts: [], nextCursor: null };
      },
    },
    reconciler: {
      reconcile: async (checkoutId, lease) => {
        reconcileCalls.push([checkoutId, lease]);
        const outcome = outcomes.get(checkoutId);
        if (outcome instanceof Error) throw outcome;
        return outcome ?? { outcome: 'awarded' };
      },
    },
    ownerId: 'loyalty-worker',
    nowIso: () => T0,
    monotonicNowMs: () => {
      last = times.shift() ?? last;
      return last;
    },
    newId: () => `lease-${++id}`,
    reportFailure: options.reportFailure ?? ((failure) => reports.push(failure)),
  });
  return { worker, dueCalls, reconcileCalls, reports };
}

describe('LoyaltyReconciliationWorker', () => {
  it('uses one bounded due snapshot and accounts for every loyalty outcome', async () => {
    const cursor = { asOf: T0, nextActionAt: T0, checkoutId: 'checkout-2' };
    const ctx = setup({
      pages: [
        { checkouts: [{ id: 'checkout-1' }, { id: 'checkout-2' }], nextCursor: cursor },
        { checkouts: [{ id: 'checkout-3' }, { id: 'checkout-4' }], nextCursor: null },
      ],
      outcomes: [
        ['checkout-2', { outcome: 'rescheduled' }],
        ['checkout-3', { outcome: 'manual-review' }],
        ['checkout-4', { outcome: 'busy' }],
      ],
    });

    const result = await ctx.worker.run({ maxCheckouts: 4, pageSize: 2, maxDurationMs: 1_000 });
    assert.deepEqual(ctx.dueCalls, [
      { asOf: T0, limit: 2, cursor: undefined },
      { asOf: T0, limit: 2, cursor },
    ]);
    assert.deepEqual(result, {
      asOf: T0,
      attempted: 4,
      awarded: 1,
      rescheduled: 1,
      manualReview: 1,
      busy: 1,
      failed: 0,
      failureReportsDropped: 0,
      exhausted: false,
      exhaustionReason: null,
    });
  });

  it('isolates one loyalty failure and continues without affecting payment reconciliation', async () => {
    const failure = new Error('loyalty database unavailable');
    const ctx = setup({
      pages: [{ checkouts: [{ id: 'checkout-1' }, { id: 'checkout-2' }], nextCursor: null }],
      outcomes: [['checkout-1', failure]],
    });
    const result = await ctx.worker.run({ maxCheckouts: 10, pageSize: 10, maxDurationMs: 1_000 });
    assert.equal(result.failed, 1);
    assert.equal(result.awarded, 1);
    assert.deepEqual(ctx.reports, [{ checkoutId: 'checkout-1', error: failure }]);
  });

  it('enforces invocation count and wall-clock limits', async () => {
    const count = setup({
      pages: [
        {
          checkouts: [{ id: 'checkout-1' }, { id: 'checkout-2' }],
          nextCursor: { asOf: T0, nextActionAt: T0, checkoutId: 'checkout-2' },
        },
      ],
    });
    const countResult = await count.worker.run({
      maxCheckouts: 2,
      pageSize: 2,
      maxDurationMs: 1_000,
    });
    assert.equal(countResult.exhaustionReason, 'count');

    const deadline = setup({ times: [100, 200] });
    const deadlineResult = await deadline.worker.run({
      maxCheckouts: 10,
      pageSize: 10,
      maxDurationMs: 100,
    });
    assert.equal(deadlineResult.exhaustionReason, 'deadline');
    assert.equal(deadline.dueCalls.length, 0);
  });

  it('rejects unbounded options before querying', async () => {
    const ctx = setup();
    await assert.rejects(
      ctx.worker.run({ maxCheckouts: 1_001, pageSize: 1, maxDurationMs: 1 }),
      /maxCheckouts/
    );
    await assert.rejects(
      ctx.worker.run({ maxCheckouts: 1, pageSize: 101, maxDurationMs: 1 }),
      /pageSize/
    );
    assert.equal(ctx.dueCalls.length, 0);
  });
});
