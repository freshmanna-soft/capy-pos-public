import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../shared/src/document-store.ts';
import { CheckoutState } from './checkout-state.ts';
import { DocumentCheckoutStore, MemoryDueCheckoutReader } from './checkout-store.ts';

const T0 = '2026-09-18T12:00:00.000Z';
const T1 = '2026-09-18T12:01:00.000Z';
const T2 = '2026-09-18T12:02:00.000Z';

function checkout(overrides = {}) {
  return {
    id: 'checkout-1',
    kind: 'checkout',
    idempotencyKeyHash: 'key-hash',
    idempotencyKeyVersion: 'v1',
    requestFingerprint: 'request-hash',
    capabilityTokenHash: 'token-hash',
    capabilityKeyVersion: 'v1',
    storeId: 'store-1',
    expectedPayPalMerchantId: 'merchant-1',
    state: CheckoutState.CREATING,
    quote: {
      currency: 'USD',
      taxRateBasisPoints: 850,
      lines: [
        {
          productId: 'p-1',
          productName: 'Oats',
          quantity: 1,
          unitPriceMinorUnits: 100,
          subtotalMinorUnits: 100,
        },
      ],
      subtotalMinorUnits: 100,
      taxMinorUnits: 9,
      totalMinorUnits: 109,
    },
    paypalOrderId: null,
    paypalAuthorizationId: null,
    paypalCaptureId: null,
    paypalRequestIds: {
      createOrder: 'request-create',
      authorizeOrder: 'request-authorize',
      captureAuthorization: 'request-capture',
      voidAuthorization: 'request-void',
    },
    receipt: null,
    lastFailure: null,
    attempts: 0,
    nextActionAt: T1,
    lease: null,
    createdAt: T0,
    updatedAt: T0,
    expiresAt: T2,
    ...overrides,
  };
}

function context(seed = [], digest = (input) => Buffer.from(input).toString('base64url')) {
  const documents = new MemoryStore(seed.map((document) => checkout(document)));
  const due = new MemoryDueCheckoutReader(documents);
  return { documents, store: new DocumentCheckoutStore(documents, digest, due) };
}

describe('checkout document persistence', () => {
  it('persists the pricing module quote shape and validates arithmetic', async () => {
    const { store } = context();
    assert.equal(await store.create(checkout()), 'created');
    await assert.rejects(() =>
      store.create(
        checkout({ id: 'checkout-bad', quote: { ...checkout().quote, totalMinorUnits: 110 } })
      )
    );
  });

  it('binds compare-and-swap to the id, immutable facts, and legal state transitions', async () => {
    const { store } = context();
    await store.create(checkout({ id: 'checkout-a' }));
    await store.create(checkout({ id: 'checkout-b' }));
    const a = await store.read('checkout-a');
    await assert.rejects(() =>
      store.compareAndSwap('checkout-a', { ...a.document, id: 'checkout-b' }, a.revision)
    );
    const b = await store.read('checkout-b');
    assert.notEqual(a.revision, b.revision);
    assert.equal(
      await store.compareAndSwap('checkout-b', { ...b.document, updatedAt: T1 }, a.revision),
      'conflict'
    );
    assert.equal(
      await store.compareAndSwap('checkout-b', { ...b.document, updatedAt: T1 }, {}),
      'conflict'
    );
    await assert.rejects(() =>
      store.compareAndSwap(
        'checkout-a',
        { ...a.document, requestFingerprint: 'changed-request' },
        a.revision
      )
    );
    await assert.rejects(() =>
      store.compareAndSwap(
        'checkout-a',
        {
          ...a.document,
          state: CheckoutState.COMPLETED,
          paypalOrderId: 'order',
          paypalAuthorizationId: 'authorization',
          paypalCaptureId: 'capture',
          receipt: {
            transactionId: 'transaction',
            checkoutId: 'checkout-a',
            quote: a.document.quote,
            paypalCaptureId: 'capture',
            completedAt: T1,
          },
          updatedAt: T1,
        },
        a.revision
      )
    );
    assert.equal((await store.read('checkout-b')).document.requestFingerprint, 'request-hash');
  });

  it('rejects corrupt states, timestamps, nested shapes, and state-dependent bindings', async () => {
    const { store } = context();
    await assert.rejects(() => store.create(checkout({ state: 'bogus' })));
    await assert.rejects(() =>
      store.create(checkout({ id: 'bad-time', nextActionAt: 'tomorrow' }))
    );
    for (const [id, providerIds] of [
      ['premature-order', { paypalOrderId: 'o' }],
      ['premature-authorization', { paypalAuthorizationId: 'a' }],
      ['premature-capture', { paypalCaptureId: 'c' }],
    ]) {
      await assert.rejects(() => store.create(checkout({ id, ...providerIds })));
    }
    await assert.rejects(() =>
      store.create(
        checkout({
          id: 'bad-capture',
          state: CheckoutState.CAPTURED_PENDING_COMMIT,
          paypalOrderId: 'o',
          paypalAuthorizationId: 'a',
        })
      )
    );
    await assert.rejects(() =>
      store.create(checkout({ id: 'missing-requests', paypalRequestIds: null }))
    );
    await assert.rejects(() =>
      store.create(
        checkout({
          id: 'extra-request-field',
          paypalRequestIds: { ...checkout().paypalRequestIds, payerData: 'untrusted' },
        })
      )
    );
    await assert.rejects(() =>
      store.create(checkout({ id: 'bad-lease', lease: { ownerId: 'worker' } }))
    );
    await assert.rejects(() =>
      store.create(
        checkout({
          id: 'terminal-scheduled',
          state: CheckoutState.EXPIRED,
          nextActionAt: T1,
        })
      )
    );
    await assert.rejects(() =>
      store.create(
        checkout({
          id: 'terminal-leased',
          state: CheckoutState.EXPIRED,
          nextActionAt: null,
          lease: { ownerId: 'worker', leaseId: 'lease', expiresAt: T2 },
        })
      )
    );
    await assert.rejects(() => store.create({ ...checkout(), browserPaymentStatus: 'paid' }));
  });

  it('compares receipt quotes structurally rather than by property insertion order', async () => {
    const base = checkout({
      id: 'checkout-complete',
      state: CheckoutState.COMPLETED,
      paypalOrderId: 'order',
      paypalAuthorizationId: 'authorization',
      paypalCaptureId: 'capture',
      nextActionAt: null,
      updatedAt: T1,
    });
    const reorderedQuote = {
      totalMinorUnits: base.quote.totalMinorUnits,
      taxMinorUnits: base.quote.taxMinorUnits,
      subtotalMinorUnits: base.quote.subtotalMinorUnits,
      lines: base.quote.lines.map((line) => ({
        subtotalMinorUnits: line.subtotalMinorUnits,
        unitPriceMinorUnits: line.unitPriceMinorUnits,
        quantity: line.quantity,
        productName: line.productName,
        productId: line.productId,
      })),
      taxRateBasisPoints: base.quote.taxRateBasisPoints,
      currency: base.quote.currency,
    };
    const { store } = context();
    assert.equal(
      await store.create({
        ...base,
        receipt: {
          transactionId: 'transaction',
          checkoutId: base.id,
          quote: reorderedQuote,
          paypalCaptureId: 'capture',
          completedAt: T1,
        },
      }),
      'created'
    );
    await assert.rejects(() =>
      store.create({
        ...base,
        id: 'checkout-future-receipt',
        receipt: {
          transactionId: 'transaction',
          checkoutId: 'checkout-future-receipt',
          quote: reorderedQuote,
          paypalCaptureId: 'capture',
          completedAt: T2,
        },
      })
    );
  });
});

describe('checkout uniqueness claims', () => {
  it('replays equal idempotency requests and conflicts changed bodies', async () => {
    const { store } = context();
    const input = {
      keyHash: 'key',
      keyVersion: 'v1',
      requestFingerprint: 'body-a',
      checkoutId: 'checkout-a',
      nowIso: T0,
    };
    assert.deepEqual(
      await store.lookupIdempotency({
        keyHash: input.keyHash,
        keyVersion: input.keyVersion,
        requestFingerprint: input.requestFingerprint,
      }),
      { outcome: 'missing' }
    );
    assert.equal((await store.claimIdempotency(input)).outcome, 'claimed');
    assert.deepEqual(
      await store.lookupIdempotency({
        keyHash: input.keyHash,
        keyVersion: input.keyVersion,
        requestFingerprint: input.requestFingerprint,
      }),
      { outcome: 'replay', checkoutId: 'checkout-a' }
    );
    assert.deepEqual(
      await store.lookupIdempotency({
        keyHash: input.keyHash,
        keyVersion: input.keyVersion,
        requestFingerprint: 'body-b',
      }),
      { outcome: 'conflict', checkoutId: 'checkout-a' }
    );
    assert.deepEqual(await store.claimIdempotency({ ...input, checkoutId: 'checkout-b' }), {
      outcome: 'replay',
      checkoutId: 'checkout-a',
    });
    assert.deepEqual(
      await store.claimIdempotency({
        ...input,
        requestFingerprint: 'body-b',
        checkoutId: 'checkout-b',
      }),
      { outcome: 'conflict', checkoutId: 'checkout-a' }
    );
  });

  it('uses fixed disjoint namespaces and reports digest collisions', async () => {
    const { store } = context([], () => 'same-digest');
    await store.claimIdempotency({
      keyHash: 'key-a',
      keyVersion: 'v1',
      requestFingerprint: 'body',
      checkoutId: 'checkout-a',
      nowIso: T0,
    });
    assert.deepEqual(
      await store.claimIdempotency({
        keyHash: 'key-b',
        keyVersion: 'v1',
        requestFingerprint: 'body',
        checkoutId: 'checkout-b',
        nowIso: T0,
      }),
      { outcome: 'digest-collision' }
    );
    assert.equal(
      (
        await store.bindProviderReference({
          referenceKind: 'order',
          referenceId: 'order-a',
          checkoutId: 'checkout-a',
          nowIso: T0,
        })
      ).outcome,
      'claimed'
    );
    assert.equal(
      (
        await store.bindProviderReference({
          referenceKind: 'order',
          referenceId: 'order-b',
          checkoutId: 'checkout-b',
          nowIso: T0,
        })
      ).outcome,
      'digest-collision'
    );
    await assert.rejects(() => store.create(checkout({ id: 'checkout-claim:forbidden' })));
  });

  it('rejects unknown fields in persisted claim and provider-binding records', async () => {
    const digest = (input) => Buffer.from(input).toString('base64url');
    const idempotencyId = `checkout-claim:idempotency:${digest('idempotency\0v1\0key')}`;
    const bindingId = `checkout-claim:paypal:order:${digest('paypal\0order\0order-1')}`;
    const documents = new MemoryStore([
      {
        id: idempotencyId,
        kind: 'checkout-idempotency-claim',
        keyHash: 'key',
        keyVersion: 'v1',
        requestFingerprint: 'body',
        checkoutId: 'checkout-a',
        createdAt: T0,
        untrusted: true,
      },
      {
        id: bindingId,
        kind: 'checkout-provider-binding',
        referenceKind: 'order',
        referenceId: 'order-1',
        checkoutId: 'checkout-a',
        createdAt: T0,
        untrusted: true,
      },
    ]);
    const store = new DocumentCheckoutStore(
      documents,
      digest,
      new MemoryDueCheckoutReader(documents)
    );
    await assert.rejects(() =>
      store.claimIdempotency({
        keyHash: 'key',
        keyVersion: 'v1',
        requestFingerprint: 'body',
        checkoutId: 'checkout-a',
        nowIso: T0,
      })
    );
    await assert.rejects(() =>
      store.bindProviderReference({
        referenceKind: 'order',
        referenceId: 'order-1',
        checkoutId: 'checkout-a',
        nowIso: T0,
      })
    );
  });

  it('versions idempotency claims for safe HMAC key rotation', async () => {
    const { store } = context();
    const common = {
      keyHash: 'key',
      requestFingerprint: 'body',
      checkoutId: 'checkout-a',
      nowIso: T0,
    };
    assert.equal(
      (await store.claimIdempotency({ ...common, keyVersion: 'v1' })).outcome,
      'claimed'
    );
    assert.equal(
      (await store.claimIdempotency({ ...common, keyVersion: 'v2' })).outcome,
      'claimed'
    );
  });

  it('prevents one PayPal reference from funding two checkouts', async () => {
    const { store } = context();
    const first = {
      referenceKind: 'capture',
      referenceId: 'capture-1',
      checkoutId: 'checkout-a',
      nowIso: T0,
    };
    assert.equal((await store.bindProviderReference(first)).outcome, 'claimed');
    assert.equal((await store.bindProviderReference(first)).outcome, 'replay');
    assert.deepEqual(await store.bindProviderReference({ ...first, checkoutId: 'checkout-b' }), {
      outcome: 'conflict',
      checkoutId: 'checkout-a',
    });
  });
});

describe('reconciliation lease fencing', () => {
  it('requires matching owner and lease id for replay, renewal, and release', async () => {
    const { store } = context([checkout()]);
    const acquired = await store.tryAcquireLease({
      checkoutId: 'checkout-1',
      ownerId: 'worker-a',
      leaseId: 'lease-1',
      nowIso: T0,
      expiresAtIso: T2,
    });
    assert.equal(acquired.outcome, 'acquired');
    const replay = await store.tryAcquireLease({
      checkoutId: 'checkout-1',
      ownerId: 'worker-a',
      leaseId: 'lease-1',
      nowIso: T1,
      expiresAtIso: T2,
    });
    assert.equal(replay.outcome, 'replay');
    const impostor = await store.tryAcquireLease({
      checkoutId: 'checkout-1',
      ownerId: 'worker-b',
      leaseId: 'lease-1',
      nowIso: T1,
      expiresAtIso: T2,
    });
    assert.equal(impostor.outcome, 'busy');
    assert.equal(
      await store.renewLease({
        checkoutId: 'checkout-1',
        ownerId: 'worker-b',
        leaseId: 'lease-1',
        nowIso: T1,
        expiresAtIso: T2,
      }),
      'lost'
    );
    assert.equal(
      await store.releaseLease({
        checkoutId: 'checkout-1',
        ownerId: 'worker-b',
        leaseId: 'lease-1',
        nowIso: T1,
      }),
      'lost'
    );
  });

  it('never replays an expired lease and allows CAS replacement', async () => {
    const { store } = context([checkout()]);
    await store.tryAcquireLease({
      checkoutId: 'checkout-1',
      ownerId: 'worker-a',
      leaseId: 'lease-1',
      nowIso: T0,
      expiresAtIso: T1,
    });
    const replaced = await store.tryAcquireLease({
      checkoutId: 'checkout-1',
      ownerId: 'worker-b',
      leaseId: 'lease-2',
      nowIso: T1,
      expiresAtIso: T2,
    });
    assert.equal(replaced.outcome, 'acquired');
    const oldReplay = await store.tryAcquireLease({
      checkoutId: 'checkout-1',
      ownerId: 'worker-a',
      leaseId: 'lease-1',
      nowIso: T1,
      expiresAtIso: T2,
    });
    assert.equal(oldReplay.outcome, 'busy');
  });

  it('atomically fences checkout CAS by the current unexpired lease', async () => {
    const { store } = context([checkout()]);
    await store.tryAcquireLease({
      checkoutId: 'checkout-1',
      ownerId: 'worker-a',
      leaseId: 'lease-1',
      nowIso: T0,
      expiresAtIso: T1,
    });
    const staleOwner = await store.read('checkout-1');
    assert.equal(
      await store.compareAndSwap(
        'checkout-1',
        { ...staleOwner.document, attempts: 1, updatedAt: T1 },
        staleOwner.revision,
        { ownerId: 'worker-a', leaseId: 'lease-1', nowIso: T1 }
      ),
      'conflict'
    );

    await store.tryAcquireLease({
      checkoutId: 'checkout-1',
      ownerId: 'worker-b',
      leaseId: 'lease-2',
      nowIso: T1,
      expiresAtIso: T2,
    });
    const current = await store.read('checkout-1');
    assert.equal(
      await store.compareAndSwap(
        'checkout-1',
        { ...current.document, attempts: 1, updatedAt: T1 },
        current.revision,
        { ownerId: 'worker-a', leaseId: 'lease-1', nowIso: T1 }
      ),
      'conflict'
    );
    assert.equal(
      await store.compareAndSwap(
        'checkout-1',
        { ...current.document, attempts: 1, updatedAt: T1 },
        current.revision,
        { ownerId: 'worker-b', leaseId: 'lease-2', nowIso: T1 }
      ),
      'written'
    );
  });

  it('allows a fenced terminal transition to clear but never replace the held lease', async () => {
    const { store } = context([checkout()]);
    await store.tryAcquireLease({
      checkoutId: 'checkout-1',
      ownerId: 'worker-a',
      leaseId: 'lease-1',
      nowIso: T0,
      expiresAtIso: T2,
    });
    const current = await store.read('checkout-1');
    await assert.rejects(() =>
      store.compareAndSwap(
        'checkout-1',
        {
          ...current.document,
          lease: { ownerId: 'worker-b', leaseId: 'lease-2', expiresAt: T2 },
          updatedAt: T1,
        },
        current.revision,
        { ownerId: 'worker-a', leaseId: 'lease-1', nowIso: T1 }
      )
    );
    assert.equal(
      await store.compareAndSwap(
        'checkout-1',
        {
          ...current.document,
          state: CheckoutState.EXPIRED,
          nextActionAt: null,
          lease: null,
          updatedAt: T1,
        },
        current.revision,
        { ownerId: 'worker-a', leaseId: 'lease-1', nowIso: T1 }
      ),
      'written'
    );
  });
});

describe('due checkout contract', () => {
  it('uses bounded at-least-once pages and keeps production querying injectable', async () => {
    const calls = [];
    const dueReader = {
      listDue: async (input) => {
        calls.push(input);
        return { checkouts: [checkout()], nextCursor: null };
      },
    };
    const documents = new MemoryStore();
    const store = new DocumentCheckoutStore(
      documents,
      (value) => Buffer.from(value).toString('base64url'),
      dueReader
    );
    const page = await store.listDue({ asOf: T1, limit: 1 });
    assert.equal(page.checkouts.length, 1);
    assert.equal(calls.length, 1);
    await assert.rejects(() => store.listDue({ asOf: T1, limit: 101 }));
  });

  it('local reader orders a due page, excludes terminal rows, and does not promise a snapshot', async () => {
    const { store } = context([
      checkout({ id: 'checkout-b', nextActionAt: T1 }),
      checkout({ id: 'checkout-a', nextActionAt: T1 }),
      checkout({ id: 'checkout-terminal', state: CheckoutState.EXPIRED, nextActionAt: null }),
    ]);
    const first = await store.listDue({ asOf: T2, limit: 1 });
    assert.equal(first.checkouts[0].id, 'checkout-a');
    assert.ok(first.nextCursor);
    const second = await store.listDue({ asOf: T2, limit: 1, cursor: first.nextCursor });
    assert.equal(second.checkouts[0].id, 'checkout-b');
    assert.equal(second.nextCursor, null);
  });

  it('rejects invalid, unordered, terminal, and cursor-mismatched injected pages', async () => {
    async function rejectsPage(page) {
      const documents = new MemoryStore();
      const store = new DocumentCheckoutStore(
        documents,
        (value) => Buffer.from(value).toString('base64url'),
        { listDue: async () => page }
      );
      await assert.rejects(() => store.listDue({ asOf: T2, limit: 2 }));
    }

    await rejectsPage({ checkouts: [checkout({ nextActionAt: null })], nextCursor: null });
    await rejectsPage({
      checkouts: [checkout({ state: CheckoutState.EXPIRED, nextActionAt: null })],
      nextCursor: null,
    });
    await rejectsPage({
      checkouts: [
        checkout({ id: 'checkout-b', nextActionAt: T1 }),
        checkout({ id: 'checkout-a', nextActionAt: T1 }),
      ],
      nextCursor: null,
    });
    await rejectsPage({
      checkouts: [checkout()],
      nextCursor: { asOf: T2, nextActionAt: T1, checkoutId: 'some-other-checkout' },
    });
  });
});
