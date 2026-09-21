import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../shared/src/document-store.ts';
import { DocumentCheckoutStore, MemoryDueCheckoutReader } from './checkout-store.ts';
import { CheckoutLoyaltyStore, MemoryDueLoyaltyReader } from './checkout-loyalty-store.ts';

const T0 = '2027-01-15T10:00:00.000Z';
const T1 = '2027-01-15T10:00:01.000Z';
const T2 = '2027-01-15T10:01:00.000Z';
const CUSTOMER = {
  kind: 'customer',
  issuer: 'https://issuer.example',
  subject: 'subject-1',
  tenantId: 'default-tenant',
  customerKey: 'customer-key-1',
  keyVersion: 'sha256-v1',
};

function checkout(id = 'checkout-1', nextActionAt = T0) {
  const quote = {
    currency: 'USD',
    taxRateBasisPoints: 850,
    lines: [
      {
        productId: 'p-1',
        productName: 'Oats',
        quantity: 1,
        unitPriceMinorUnits: 1200,
        subtotalMinorUnits: 1200,
      },
    ],
    subtotalMinorUnits: 1200,
    taxMinorUnits: 102,
    totalMinorUnits: 1302,
  };
  return {
    id,
    kind: 'checkout',
    schemaVersion: 'v2',
    requestFingerprintVersion: 'customer-binding-v2',
    customerBinding: CUSTOMER,
    idempotencyKeyHash: 'key-hash',
    idempotencyKeyVersion: 'v1',
    requestFingerprint: 'request-hash',
    capabilityTokenHash: 'token-hash',
    capabilityKeyVersion: 'v1',
    storeId: 'store-1',
    expectedPayPalMerchantId: 'merchant-1',
    state: 'completed',
    quote,
    paypalOrderId: 'order-1',
    paypalAuthorizationId: 'authorization-1',
    paypalCaptureId: 'capture-1',
    paypalRequestIds: {
      createOrder: 'create',
      authorizeOrder: 'authorize',
      captureAuthorization: 'capture',
      voidAuthorization: 'void',
    },
    receipt: {
      schemaVersion: 'v2',
      requestFingerprintVersion: 'customer-binding-v2',
      transactionId: 'transaction-1',
      checkoutId: id,
      quote,
      paypalCaptureId: 'capture-1',
      completedAt: T0,
    },
    loyalty: {
      status: 'pending',
      customerKey: CUSTOMER.customerKey,
      pointsEarned: 120,
      policyVersion: 'self-checkout-usd-v1',
      nextActionAt,
      attempts: 0,
      lease: null,
    },
    lastFailure: null,
    attempts: 7,
    nextActionAt: null,
    lease: null,
    createdAt: T0,
    updatedAt: T0,
    expiresAt: T2,
  };
}

function setup(seed = [checkout()]) {
  const documents = new MemoryStore(seed);
  const checkouts = new DocumentCheckoutStore(
    documents,
    (input) => Buffer.from(input).toString('base64url'),
    new MemoryDueCheckoutReader(documents)
  );
  return {
    documents,
    store: new CheckoutLoyaltyStore(checkouts, new MemoryDueLoyaltyReader(documents)),
  };
}

const lease = {
  checkoutId: 'checkout-1',
  ownerId: 'loyalty-worker',
  leaseId: 'lease-1',
  nowIso: T0,
  expiresAtIso: T2,
};

describe('CheckoutLoyaltyStore', () => {
  it('pages only completed pending loyalty obligations in strict due order', async () => {
    const ctx = setup([checkout('checkout-2', T1), checkout('checkout-1', T0)]);
    const first = await ctx.store.listDueLoyalty({ asOf: T1, limit: 1 });
    assert.deepEqual(first.checkouts, [{ id: 'checkout-1' }]);
    assert.deepEqual(first.nextCursor, { asOf: T1, nextActionAt: T0, checkoutId: 'checkout-1' });
    const second = await ctx.store.listDueLoyalty({ asOf: T1, limit: 1, cursor: first.nextCursor });
    assert.deepEqual(second.checkouts, [{ id: 'checkout-2' }]);
    assert.equal(second.nextCursor, null);
  });

  it('acquires and renews a loyalty lease without touching payment lease or financial data', async () => {
    const ctx = setup();
    const acquired = await ctx.store.tryAcquireLoyaltyLease(lease);
    assert.equal(acquired.outcome, 'acquired');
    assert.equal(acquired.checkout.settlement.transactionId, 'transaction-1');
    assert.equal(await ctx.store.renewLoyaltyLease({ ...lease, nowIso: T1 }), 'written');
    const persisted = (await ctx.documents.read('checkout-1')).document;
    assert.equal(persisted.state, 'completed');
    assert.equal(persisted.receipt.transactionId, 'transaction-1');
    assert.equal(persisted.lease, null);
    assert.equal(persisted.attempts, 7);
    assert.equal(persisted.loyalty.lease.leaseId, 'lease-1');
  });

  it('awards, reschedules, and sends only loyalty to manual review', async () => {
    for (const [mode, expected] of [
      ['awarded', { status: 'awarded', attempts: 0, nextActionAt: null }],
      ['rescheduled', { status: 'pending', attempts: 2, nextActionAt: T2 }],
      ['manual', { status: 'manual-review', attempts: 3, nextActionAt: null }],
    ]) {
      const ctx = setup();
      await ctx.store.tryAcquireLoyaltyLease(lease);
      const outcome =
        mode === 'awarded'
          ? await ctx.store.markLoyaltyAwarded({
              ...lease,
              result: {
                outcome: 'awarded',
                pointsEarned: 120,
                policyVersion: 'self-checkout-usd-v1',
                balance: 120,
                tier: 'bronze',
              },
            })
          : mode === 'rescheduled'
            ? await ctx.store.rescheduleLoyalty({ ...lease, nextActionAt: T2, attempts: 2 })
            : await ctx.store.markLoyaltyManualReview({
                ...lease,
                attempts: 3,
                reason: 'settlement-corruption',
              });
      assert.equal(outcome, 'written');
      const persisted = (await ctx.documents.read('checkout-1')).document;
      assert.equal(persisted.state, 'completed');
      assert.equal(persisted.receipt.transactionId, 'transaction-1');
      assert.equal(persisted.loyalty.status, expected.status);
      assert.equal(persisted.loyalty.attempts, expected.attempts);
      assert.equal(persisted.loyalty.nextActionAt, expected.nextActionAt);
      assert.equal(persisted.loyalty.lease, null);
    }
  });

  it('loses stale loyalty leases instead of mutating the checkout', async () => {
    const ctx = setup();
    await ctx.store.tryAcquireLoyaltyLease(lease);
    assert.equal(
      await ctx.store.rescheduleLoyalty({
        ...lease,
        ownerId: 'other-worker',
        nextActionAt: T2,
        attempts: 1,
      }),
      'lost'
    );
    const persisted = (await ctx.documents.read('checkout-1')).document;
    assert.equal(persisted.loyalty.attempts, 0);
    assert.equal(persisted.loyalty.lease.ownerId, 'loyalty-worker');
  });
});
