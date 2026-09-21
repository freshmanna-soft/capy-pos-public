import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../shared/src/document-store.ts';
import {
  CheckoutTransactionCorruptionError,
  checkoutInventoryOf,
  checkoutTransactionId,
  persistCheckoutTransaction,
  publicCheckoutSaleTransaction,
  productAvailableStock,
  productHasActiveReservations,
} from './checkout-fulfillment.ts';

const COMPLETED_AT = '2027-01-15T10:00:00.000Z';
const quote = Object.freeze({
  currency: 'USD',
  taxRateBasisPoints: 850,
  lines: Object.freeze([
    Object.freeze({
      productId: 'p-1',
      productName: 'Oat Milk',
      quantity: 2,
      unitPriceMinorUnits: 150,
      subtotalMinorUnits: 300,
    }),
  ]),
  subtotalMinorUnits: 300,
  taxMinorUnits: 26,
  totalMinorUnits: 326,
});

function transactionInput(overrides = {}) {
  return {
    checkoutId: 'checkout-1',
    paypalCaptureId: 'capture-1',
    storeId: 'store-1',
    quote,
    completedAt: COMPLETED_AT,
    ...overrides,
  };
}

describe('reservation-aware product persistence', () => {
  it('treats a pre-migration product without checkout markers as having no reservations', () => {
    const inventory = checkoutInventoryOf({ stock: 7 });
    assert.equal(inventory.stock, 7);
    assert.deepEqual(Object.keys(inventory.checkoutMarkers), []);
    assert.equal(productAvailableStock({ stock: 7 }), 7);
    assert.equal(productHasActiveReservations({ stock: 7 }), false);
  });

  it('subtracts only active reservations from available stock', () => {
    const product = {
      stock: 7,
      checkoutMarkers: {
        active: { state: 'reserved', quantity: 3, reservedAt: '2027-01-15T09:00:00.000Z' },
        committed: {
          state: 'committed',
          quantity: 2,
          reservedAt: '2027-01-15T08:00:00.000Z',
          committedAt: '2027-01-15T08:01:00.000Z',
        },
      },
    };
    assert.equal(productAvailableStock(product), 4);
    assert.equal(productHasActiveReservations(product), true);
  });

  it('fails closed when persisted reservations exceed physical stock', () => {
    assert.throws(
      () =>
        productAvailableStock({
          stock: 1,
          checkoutMarkers: {
            checkout: {
              state: 'reserved',
              quantity: 2,
              reservedAt: '2027-01-15T09:00:00.000Z',
            },
          },
        }),
      /reservations exceed/i
    );
  });
});

describe('checkout transaction persistence', () => {
  it('creates one basket transaction with a stable checkout-derived id', async () => {
    const transactions = new MemoryStore();
    const result = await persistCheckoutTransaction(transactions, transactionInput());
    assert.equal(result.outcome, 'created');
    assert.equal(result.transaction.id, checkoutTransactionId('checkout-1'));
    assert.equal(result.transaction.timestamp, COMPLETED_AT);
    assert.deepEqual((await transactions.list())[0], result.transaction);
  });

  it('replays the existing transaction for the same checkout, capture, store and quote', async () => {
    const transactions = new MemoryStore();
    const first = await persistCheckoutTransaction(transactions, transactionInput());
    const second = await persistCheckoutTransaction(transactions, transactionInput());
    assert.equal(first.outcome, 'created');
    assert.equal(second.outcome, 'replay');
    assert.deepEqual(second.transaction, first.transaction);
    assert.equal((await transactions.list()).length, 1);
  });

  it('writes V2 only when explicitly selected and redacts its customer binding', async () => {
    const transactions = new MemoryStore();
    const result = await persistCheckoutTransaction(
      transactions,
      transactionInput({
        schemaVersion: 'v2',
        customerBinding: { customerKey: 'customer-key-a', keyVersion: 'sha256-v1' },
      })
    );
    assert.equal(result.transaction.schemaVersion, 'v2');
    assert.deepEqual(result.transaction.customerBinding, {
      customerKey: 'customer-key-a',
      keyVersion: 'sha256-v1',
    });
    const projected = publicCheckoutSaleTransaction(result.transaction);
    assert.equal('schemaVersion' in projected, false);
    assert.equal('customerBinding' in projected, false);
    assert.deepEqual(projected, {
      id: checkoutTransactionId('checkout-1'),
      kind: 'checkout-sale',
      type: 'sale',
      checkoutId: 'checkout-1',
      paypalCaptureId: 'capture-1',
      storeId: 'store-1',
      quote,
      timestamp: COMPLETED_AT,
    });
  });

  it('supports an explicit V2 guest transaction without inventing customer identity', async () => {
    const transactions = new MemoryStore();
    const result = await persistCheckoutTransaction(
      transactions,
      transactionInput({ schemaVersion: 'v2', customerBinding: null })
    );
    assert.equal(result.transaction.schemaVersion, 'v2');
    assert.equal(result.transaction.customerBinding, null);
  });

  it('fails closed when a replay changes V2 customer ownership or schema', async () => {
    const transactions = new MemoryStore();
    const input = transactionInput({
      schemaVersion: 'v2',
      customerBinding: { customerKey: 'customer-key-a', keyVersion: 'sha256-v1' },
    });
    await persistCheckoutTransaction(transactions, input);
    await assert.rejects(
      persistCheckoutTransaction(transactions, {
        ...input,
        customerBinding: { customerKey: 'customer-key-b', keyVersion: 'sha256-v1' },
      }),
      (error) =>
        error instanceof CheckoutTransactionCorruptionError && error.code === 'binding-conflict'
    );
    await assert.rejects(
      persistCheckoutTransaction(transactions, transactionInput()),
      (error) =>
        error instanceof CheckoutTransactionCorruptionError && error.code === 'binding-conflict'
    );
  });

  it('reads exact legacy and V2 records across the rollout floor', async () => {
    const legacy = {
      id: checkoutTransactionId('checkout-1'),
      kind: 'checkout-sale',
      type: 'sale',
      checkoutId: 'checkout-1',
      paypalCaptureId: 'capture-1',
      storeId: 'store-1',
      quote,
      timestamp: COMPLETED_AT,
    };
    const legacyStore = new MemoryStore([legacy]);
    const legacyReplay = await persistCheckoutTransaction(legacyStore, transactionInput());
    assert.equal(legacyReplay.outcome, 'replay');
    assert.deepEqual(publicCheckoutSaleTransaction(legacyReplay.transaction), legacy);

    const v2 = {
      ...legacy,
      schemaVersion: 'v2',
      customerBinding: { customerKey: 'customer-key-a', keyVersion: 'sha256-v1' },
    };
    const v2Store = new MemoryStore([v2]);
    const v2Replay = await persistCheckoutTransaction(
      v2Store,
      transactionInput({
        schemaVersion: 'v2',
        customerBinding: v2.customerBinding,
      })
    );
    assert.equal(v2Replay.outcome, 'replay');
    assert.deepEqual(v2Replay.transaction, v2);
  });

  it('rejects partial or expanded V2 customer records', async () => {
    const transactions = new MemoryStore();
    await assert.rejects(
      persistCheckoutTransaction(
        transactions,
        transactionInput({
          customerBinding: { customerKey: 'customer-key-a', keyVersion: 'sha256-v1' },
        })
      )
    );
    await assert.rejects(
      persistCheckoutTransaction(
        transactions,
        transactionInput({
          schemaVersion: 'v2',
          customerBinding: {
            customerKey: 'customer-key-a',
            keyVersion: 'sha256-v1',
            subject: 'must-not-be-stored',
          },
        })
      )
    );
  });

  it('fails closed when the stable id is already bound to a different capture', async () => {
    const transactions = new MemoryStore();
    await persistCheckoutTransaction(transactions, transactionInput());
    await assert.rejects(
      persistCheckoutTransaction(
        transactions,
        transactionInput({ paypalCaptureId: 'capture-other' })
      ),
      (error) =>
        error instanceof CheckoutTransactionCorruptionError && error.code === 'binding-conflict'
    );
  });

  it('fails closed on a malformed conflicting record instead of accepting it as a replay', async () => {
    const transactions = new MemoryStore([
      {
        id: checkoutTransactionId('checkout-1'),
        type: 'sale',
        productId: 'legacy-product',
      },
    ]);
    await assert.rejects(
      persistCheckoutTransaction(transactions, transactionInput()),
      (error) =>
        error instanceof CheckoutTransactionCorruptionError && error.code === 'invalid-record'
    );
  });

  it('keeps a create-conflict read gap retryable instead of labeling it corruption', async () => {
    const transactions = {
      async create() {
        return 'conflict';
      },
      async read() {
        return null;
      },
    };

    await assert.rejects(
      persistCheckoutTransaction(transactions, transactionInput()),
      (error) => error instanceof Error && !(error instanceof CheckoutTransactionCorruptionError)
    );
  });
});
