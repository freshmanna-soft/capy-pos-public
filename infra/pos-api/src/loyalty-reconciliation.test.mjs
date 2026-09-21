import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { LoyaltyLeaseLostError, LoyaltyReconciler } from './loyalty-reconciliation.ts';
import { LoyaltySettlementCorruptionError } from './customer-loyalty-service.ts';

const T0 = '2027-01-15T10:00:00.000Z';
const T1 = '2027-01-15T10:00:01.000Z';
const identity = {
  issuer: 'https://issuer.example',
  subject: 'subject-1',
  tenantId: 'default-tenant',
  customerKey: 'customer-key-1',
  keyVersion: 'sha256-v1',
};

function settlement() {
  return {
    identity,
    checkoutId: 'checkout-1',
    transactionId: 'transaction-1',
    storeId: 'store-1',
    currency: 'USD',
    totalMinorUnits: 1_299,
  };
}

function setup({ settlementResult, settlementError, renewOutcomes = [], acquireOutcome } = {}) {
  const calls = [];
  const financial = { state: 'completed', receipt: Object.freeze({ id: 'receipt-1' }) };
  const checkout = { checkoutId: 'checkout-1', settlement: settlement(), attempts: 2 };
  const renews = [...renewOutcomes];
  const checkouts = {
    listDueLoyalty: async () => ({ checkouts: [], nextCursor: null }),
    tryAcquireLoyaltyLease: async (input) => {
      calls.push(['acquire', input]);
      return acquireOutcome ?? { outcome: 'acquired', checkout };
    },
    renewLoyaltyLease: async (input) => {
      calls.push(['renew', input]);
      return renews.shift() ?? 'written';
    },
    markLoyaltyAwarded: async (input) => {
      calls.push(['awarded', input]);
      return 'written';
    },
    rescheduleLoyalty: async (input) => {
      calls.push(['rescheduled', input]);
      return 'written';
    },
    markLoyaltyManualReview: async (input) => {
      calls.push(['manual-review', input]);
      return 'written';
    },
  };
  const loyalty = {
    settle: async (_input, fence) => {
      calls.push(['settle']);
      await fence.beforeMutation();
      if (settlementError) throw settlementError;
      return (
        settlementResult ?? {
          outcome: 'awarded',
          pointsEarned: 120,
          policyVersion: 'self-checkout-usd-v1',
          balance: 120,
          tier: 'bronze',
        }
      );
    },
  };
  const times = [T0, T0, T0, T0, T1, T1, T1];
  const reconciler = new LoyaltyReconciler({
    checkouts,
    loyalty,
    nowIso: () => times.shift() ?? T1,
    leaseDurationMs: 30_000,
  });
  return { reconciler, calls, financial };
}

const lease = { ownerId: 'loyalty-worker', leaseId: 'lease-1' };

describe('LoyaltyReconciler', () => {
  it('renews before settlement mutations and the final checkout award write', async () => {
    const ctx = setup();
    assert.deepEqual(await ctx.reconciler.reconcile('checkout-1', lease), { outcome: 'awarded' });
    assert.deepEqual(
      ctx.calls.map(([kind]) => kind),
      ['acquire', 'settle', 'renew', 'renew', 'awarded']
    );
    assert.equal(ctx.financial.state, 'completed');
    assert.equal(ctx.financial.receipt.id, 'receipt-1');
  });

  it('keeps a retryable failure pending with bounded backoff without changing financial state', async () => {
    const failure = new Error('profile store unavailable');
    const ctx = setup({ settlementError: failure });
    await assert.rejects(ctx.reconciler.reconcile('checkout-1', lease), failure);
    const reschedule = ctx.calls.find(([kind]) => kind === 'rescheduled')[1];
    assert.equal(reschedule.attempts, 3);
    assert.equal(reschedule.nextActionAt, '2027-01-15T10:00:20.000Z');
    assert.equal(ctx.financial.state, 'completed');
    assert.equal(
      ctx.calls.some(([kind]) => kind === 'manual-review'),
      false
    );
  });

  it('moves only loyalty to manual review on deterministic corruption', async () => {
    const ctx = setup({
      settlementError: new LoyaltySettlementCorruptionError('ledger-binding-conflict'),
    });
    assert.deepEqual(await ctx.reconciler.reconcile('checkout-1', lease), {
      outcome: 'manual-review',
    });
    const review = ctx.calls.find(([kind]) => kind === 'manual-review')[1];
    assert.equal(review.reason, 'settlement-corruption');
    assert.equal(ctx.financial.state, 'completed');
    assert.equal(
      ctx.calls.some(([kind]) => kind === 'rescheduled'),
      false
    );
  });

  it('reschedules a busy profile rather than allocating around its pending award', async () => {
    const ctx = setup({
      settlementResult: {
        outcome: 'busy',
        pointsEarned: 120,
        policyVersion: 'self-checkout-usd-v1',
      },
    });
    assert.deepEqual(await ctx.reconciler.reconcile('checkout-1', lease), {
      outcome: 'rescheduled',
    });
  });

  it('stops before checkout mutation when lease renewal is lost', async () => {
    const ctx = setup({ renewOutcomes: ['lost'] });
    await assert.rejects(ctx.reconciler.reconcile('checkout-1', lease), LoyaltyLeaseLostError);
    assert.equal(
      ctx.calls.some(([kind]) => kind === 'awarded'),
      false
    );
    assert.equal(
      ctx.calls.some(([kind]) => kind === 'rescheduled'),
      false
    );
  });

  it('treats an already-resolved or disappeared obligation as idempotent success', async () => {
    const ctx = setup({ acquireOutcome: { outcome: 'not-pending' } });
    assert.deepEqual(await ctx.reconciler.reconcile('checkout-1', lease), { outcome: 'awarded' });
    assert.equal(
      ctx.calls.some(([kind]) => kind === 'settle'),
      false
    );
  });
});
