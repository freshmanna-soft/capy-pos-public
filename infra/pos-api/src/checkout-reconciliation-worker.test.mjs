import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CheckoutReconciliationWorker } from './checkout-reconciliation-worker.ts';

const T0 = '2026-09-18T12:00:00.000Z';

function checkout(id) {
  return { id };
}

function worker(options = {}) {
  const dueCalls = [];
  const reconcileCalls = [];
  const pages = [...(options.pages ?? [{ checkouts: [], nextCursor: null }])];
  const outcomes = new Map(options.outcomes ?? []);
  let lease = 0;
  const instance = new CheckoutReconciliationWorker({
    dueCheckouts: {
      listDue: async (input) => {
        dueCalls.push(input);
        return pages.shift() ?? { checkouts: [], nextCursor: null };
      },
    },
    reconciler: {
      reconcile: async (checkoutId, heldLease) => {
        reconcileCalls.push([checkoutId, heldLease]);
        const outcome = outcomes.get(checkoutId);
        if (outcome instanceof Error) throw outcome;
        return outcome ?? { outcome: 'reconciled', status: {} };
      },
    },
    ownerId: 'scheduled-checkout-worker',
    nowIso: () => T0,
    newId: () => `lease-${++lease}`,
  });
  return { instance, dueCalls, reconcileCalls };
}

describe('CheckoutReconciliationWorker', () => {
  it('uses one due-time snapshot across bounded pages and distinct leases', async () => {
    const cursor = { asOf: T0, nextActionAt: T0, checkoutId: 'checkout-2' };
    const ctx = worker({
      pages: [
        { checkouts: [checkout('checkout-1'), checkout('checkout-2')], nextCursor: cursor },
        { checkouts: [checkout('checkout-3')], nextCursor: null },
      ],
    });

    const result = await ctx.instance.run({ maxCheckouts: 3, pageSize: 2 });

    assert.deepEqual(ctx.dueCalls, [
      { asOf: T0, limit: 2, cursor: undefined },
      { asOf: T0, limit: 1, cursor },
    ]);
    assert.deepEqual(ctx.reconcileCalls, [
      ['checkout-1', { ownerId: 'scheduled-checkout-worker', leaseId: 'lease-1' }],
      ['checkout-2', { ownerId: 'scheduled-checkout-worker', leaseId: 'lease-2' }],
      ['checkout-3', { ownerId: 'scheduled-checkout-worker', leaseId: 'lease-3' }],
    ]);
    assert.deepEqual(result, {
      asOf: T0,
      attempted: 3,
      reconciled: 3,
      busy: 0,
      failed: 0,
      exhausted: false,
    });
  });

  it('keeps processing after a busy checkout or isolated reconciliation failure', async () => {
    const ctx = worker({
      pages: [
        {
          checkouts: [checkout('checkout-1'), checkout('checkout-2'), checkout('checkout-3')],
          nextCursor: null,
        },
      ],
      outcomes: [
        ['checkout-1', { outcome: 'busy' }],
        ['checkout-2', new Error('isolated failure')],
      ],
    });

    const result = await ctx.instance.run({ maxCheckouts: 10, pageSize: 10 });

    assert.equal(result.attempted, 3);
    assert.equal(result.reconciled, 1);
    assert.equal(result.busy, 1);
    assert.equal(result.failed, 1);
    assert.equal(result.exhausted, false);
  });

  it('stops at the invocation cap even when the due reader reports another page', async () => {
    const cursor = { asOf: T0, nextActionAt: T0, checkoutId: 'checkout-2' };
    const ctx = worker({
      pages: [{ checkouts: [checkout('checkout-1'), checkout('checkout-2')], nextCursor: cursor }],
    });

    const result = await ctx.instance.run({ maxCheckouts: 2, pageSize: 2 });

    assert.equal(ctx.dueCalls.length, 1);
    assert.equal(result.attempted, 2);
    assert.equal(result.exhausted, true);
  });

  it('rejects unbounded options and malformed worker inputs before querying', async () => {
    const ctx = worker();
    await assert.rejects(ctx.instance.run({ maxCheckouts: 0, pageSize: 1 }), /maxCheckouts/);
    await assert.rejects(ctx.instance.run({ maxCheckouts: 1, pageSize: 101 }), /pageSize/);
    assert.equal(ctx.dueCalls.length, 0);

    assert.throws(
      () =>
        new CheckoutReconciliationWorker({
          dueCheckouts: { listDue: async () => ({ checkouts: [], nextCursor: null }) },
          reconciler: { reconcile: async () => ({ outcome: 'busy' }) },
          ownerId: 'bad\nowner',
          nowIso: () => T0,
          newId: () => 'lease-1',
        }),
      /owner id/
    );
  });
});
