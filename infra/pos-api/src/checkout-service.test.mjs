import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { MemoryStore } from '../../shared/src/document-store.ts';
import { CheckoutService, CheckoutServiceError } from './checkout-service.ts';
import { checkoutTransactionId } from './checkout-fulfillment.ts';
import { DocumentCheckoutStore, MemoryDueCheckoutReader } from './checkout-store.ts';
import { PayPalGatewayError } from './checkout-paypal.ts';

const T0 = '2026-09-18T12:00:00.000Z';
const CONFIG = {
  currency: 'USD',
  taxRateBasisPoints: 850,
  maxItemQuantity: 10_000,
  maxAggregateQuantity: 50_000,
  maxTotalMinorUnits: 100_000_000,
  storeId: 'store-1',
  expectedPayPalMerchantId: 'merchant-1',
  idempotencyKeyVersion: 'v1',
  capabilityKeyVersion: 'v1',
  paypalClientId: 'test-client',
  paypalClientSecret: 'test-secret',
  paypalEnvironment: 'sandbox',
  paypalTimeoutMs: 1_000,
};
const SECRETS = {
  idempotencyHmacKeys: {
    v1: 'idempotency-test-key-that-is-at-least-32-characters',
  },
  capabilityHmacKeys: {
    v1: 'capability-test-key-that-is-at-least-32-characters',
  },
};

function product(overrides = {}) {
  return {
    id: 'p-1',
    name: 'Oats',
    price: 1,
    category: 'feed',
    stock: 5,
    description: '',
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

function order(status = 'CREATED', authorization, input = {}) {
  const quote = input.quote ?? { currency: 'USD', totalMinorUnits: 109 };
  const total = `${Math.floor(quote.totalMinorUnits / 100)}.${String(quote.totalMinorUnits % 100).padStart(2, '0')}`;
  const checkoutId = input.checkoutId ?? 'checkout-1';
  return {
    id: 'order-1',
    intent: 'AUTHORIZE',
    status,
    purchaseUnits: [
      {
        referenceId: checkoutId,
        customId: checkoutId,
        invoiceId: checkoutId,
        amount: { currencyCode: quote.currency, value: total },
        payeeMerchantId: 'merchant-1',
        authorizations: authorization
          ? [
              {
                ...authorization,
                amount: { currencyCode: quote.currency, value: total },
                customId: checkoutId,
                invoiceId: checkoutId,
              },
            ]
          : [],
        captures: [],
      },
    ],
  };
}

function authorization(overrides = {}) {
  return {
    id: 'authorization-1',
    status: 'CREATED',
    amount: { currencyCode: 'USD', value: '1.09' },
    customId: 'checkout-1',
    invoiceId: 'checkout-1',
    payeeMerchantId: 'merchant-1',
    relatedCaptureId: null,
    ...overrides,
  };
}

function capture(overrides = {}) {
  return {
    id: 'capture-1',
    status: 'COMPLETED',
    amount: { currencyCode: 'USD', value: '1.09' },
    customId: 'checkout-1',
    invoiceId: 'checkout-1',
    payeeMerchantId: 'merchant-1',
    finalCapture: true,
    ...overrides,
  };
}

function paymentForInput(payment, input) {
  if (!input) return payment;
  const total = `${Math.floor(input.quote.totalMinorUnits / 100)}.${String(input.quote.totalMinorUnits % 100).padStart(2, '0')}`;
  return {
    ...payment,
    amount: { currencyCode: input.quote.currency, value: total },
    customId: input.checkoutId,
    invoiceId: input.checkoutId,
  };
}

class FakePayPal {
  calls = [];
  createError = null;
  authorizeError = null;
  captureError = null;
  captureLookupError = null;
  authorizationLookupError = null;
  orderLookupError = null;
  voidError = null;
  orderLookup = null;
  captureLookup = capture();
  authorizationLookup = authorization();
  createdInput = null;

  async createOrder(input) {
    this.calls.push(['create', input]);
    this.createdInput = input;
    if (this.createError) throw this.createError;
    return order('CREATED', undefined, input);
  }

  async getOrder(orderId) {
    this.calls.push(['get-order', orderId]);
    if (this.orderLookupError) throw this.orderLookupError;
    return this.orderLookup ?? order('APPROVED', undefined, this.createdInput);
  }

  async authorizeOrder(orderId, requestId) {
    this.calls.push(['authorize', orderId, requestId]);
    if (this.authorizeError) throw this.authorizeError;
    return order('COMPLETED', authorization(), this.createdInput);
  }

  async getAuthorization(authorizationId) {
    this.calls.push(['get-authorization', authorizationId]);
    if (this.authorizationLookupError) throw this.authorizationLookupError;
    return paymentForInput(this.authorizationLookup, this.createdInput);
  }

  async captureAuthorization(authorizationId, requestId) {
    this.calls.push(['capture', authorizationId, requestId]);
    if (this.captureError) throw this.captureError;
    return paymentForInput(capture(), this.createdInput);
  }

  async getCapture(captureId) {
    this.calls.push(['get-capture', captureId]);
    if (this.captureLookupError) throw this.captureLookupError;
    return paymentForInput({ ...this.captureLookup, id: captureId }, this.createdInput);
  }

  async voidAuthorization(authorizationId, requestId) {
    this.calls.push(['void', authorizationId, requestId]);
    if (this.voidError) throw this.voidError;
    return paymentForInput(authorization({ status: 'VOIDED' }), this.createdInput);
  }
}

function context(options = {}) {
  const checkoutDocuments = options.checkoutDocuments ?? new MemoryStore();
  const checkouts =
    options.checkouts ??
    new DocumentCheckoutStore(
      checkoutDocuments,
      (value) => Buffer.from(value).toString('base64url'),
      new MemoryDueCheckoutReader(checkoutDocuments)
    );
  const products = options.products ?? new MemoryStore([product()]);
  const transactions = options.transactions ?? new MemoryStore();
  const paypal = options.paypal ?? new FakePayPal();
  const ids = options.ids ?? ['checkout-1', 'checkout-token-that-is-long-enough'];
  const service = new CheckoutService({
    checkouts,
    products,
    transactions,
    paypal,
    config: CONFIG,
    secrets: SECRETS,
    nowIso: options.nowIso ?? (() => T0),
    newId: options.newId ?? (() => ids.shift() ?? 'unused-id-that-is-long-enough'),
  });
  return { service, checkouts, checkoutDocuments, products, transactions, paypal };
}

async function createCheckout(ctx) {
  return ctx.service.create(
    { items: [{ productId: 'p-1', quantity: 1 }] },
    'idempotency-key-that-is-long-enough'
  );
}

describe('checkout orchestration create flow', () => {
  it('quotes server product data and persists requested before creating PayPal order', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    assert.equal(created.checkoutId, 'checkout-1');
    assert.equal(created.paypalOrderId, 'order-1');
    assert.equal(created.quote.totalMinorUnits, 109);
    assert.deepEqual(
      ctx.paypal.calls.map(([name]) => name),
      ['create']
    );
    const checkout = await ctx.checkouts.read(created.checkoutId);
    assert.equal(checkout.document.state, 'awaiting-approval');
    assert.equal(checkout.document.paypalOrderId, 'order-1');
  });

  it('rejects browser-owned totals and stock already held by another checkout', async () => {
    const ctx = context({
      products: new MemoryStore([
        product({
          stock: 1,
          checkoutMarkers: {
            other: { state: 'reserved', quantity: 1, reservedAt: T0 },
          },
        }),
      ]),
    });
    await assert.rejects(
      ctx.service.create(
        { items: [{ productId: 'p-1', quantity: 1 }], total: 1 },
        'idempotency-key-that-is-long-enough'
      )
    );
    await assert.rejects(createCheckout(ctx), (error) => error.code === 'out-of-stock');
    assert.equal(ctx.paypal.calls.length, 0);
  });

  it('returns bad-request for malformed input and unknown product selection', async () => {
    const ctx = context();

    await assert.rejects(
      ctx.service.create(
        { items: [{ productId: 'p-1', quantity: 1 }], total: 109 },
        'idempotency-key-that-is-long-enough'
      ),
      (error) => error instanceof CheckoutServiceError && error.code === 'bad-request'
    );
    await assert.rejects(
      ctx.service.create(
        { items: [{ productId: 'missing', quantity: 1 }] },
        'another-idempotency-key-that-is-long-enough'
      ),
      (error) => error instanceof CheckoutServiceError && error.code === 'bad-request'
    );
    const inactive = context({ products: new MemoryStore([product({ isActive: false })]) });
    await assert.rejects(
      createCheckout(inactive),
      (error) => error instanceof CheckoutServiceError && error.code === 'bad-request'
    );
    assert.equal(ctx.paypal.calls.length, 0);
    assert.equal(inactive.paypal.calls.length, 0);
  });

  it('returns bad-request when the server-computed total exceeds the checkout limit', async () => {
    const ctx = context({ products: new MemoryStore([product({ price: 1_000_000 })]) });

    await assert.rejects(
      createCheckout(ctx),
      (error) => error instanceof CheckoutServiceError && error.code === 'bad-request'
    );
    assert.equal(ctx.paypal.calls.length, 0);
  });

  it('does not classify corrupt server-owned product pricing as browser input', async () => {
    const ctx = context({ products: new MemoryStore([product({ price: 1.001 })]) });

    await assert.rejects(createCheckout(ctx), (error) => error.name === 'CheckoutValidationError');
    assert.equal(ctx.paypal.calls.length, 0);
  });

  it('replays an identical create with the same checkout capability and no second order', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    const replay = await createCheckout(ctx);
    assert.deepEqual(replay, created);
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'create').length, 1);
  });

  it('collapses concurrent identical creates onto one checkout and one provider order', async () => {
    const ctx = context();
    const [first, second] = await Promise.allSettled([createCheckout(ctx), createCheckout(ctx)]);
    const fulfilled = [first, second].filter((result) => result.status === 'fulfilled');
    const retryable = [first, second].filter(
      (result) =>
        result.status === 'rejected' &&
        result.reason instanceof CheckoutServiceError &&
        result.reason.retryable
    );

    assert.ok(fulfilled.length >= 1);
    assert.equal(fulfilled.length + retryable.length, 2);
    assert.equal((await ctx.checkouts.read('checkout-1')).document.paypalOrderId, 'order-1');
    const createCalls = ctx.paypal.calls.filter(([name]) => name === 'create');
    assert.ok(createCalls.length >= 1);
    assert.ok(createCalls.every(([, input]) => input.requestId === createCalls[0][1].requestId));
  });

  it('replays a completed checkout even after the catalogue product is removed', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    await ctx.service.complete(created.checkoutId, created.checkoutToken);
    const productRevision = await ctx.products.read('p-1');
    await ctx.products.remove('p-1', productRevision.rev);

    const replay = await createCheckout(ctx);
    assert.equal(replay.checkoutId, created.checkoutId);
    assert.equal(replay.checkoutToken, created.checkoutToken);
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'create').length, 1);
  });

  it('replays across retained idempotency and capability key versions', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    const rotated = new CheckoutService({
      checkouts: ctx.checkouts,
      products: ctx.products,
      transactions: ctx.transactions,
      paypal: ctx.paypal,
      config: {
        ...CONFIG,
        idempotencyKeyVersion: 'v2',
        capabilityKeyVersion: 'v2',
      },
      secrets: {
        idempotencyHmacKeys: {
          v2: 'new-idempotency-test-key-that-is-at-least-32-characters',
          ...SECRETS.idempotencyHmacKeys,
        },
        capabilityHmacKeys: {
          v2: 'new-capability-test-key-that-is-at-least-32-characters',
          ...SECRETS.capabilityHmacKeys,
        },
      },
      nowIso: () => T0,
      newId: () => 'unused-rotated-checkout-id',
    });
    const replay = await rotated.create(
      { items: [{ productId: 'p-1', quantity: 1 }] },
      'idempotency-key-that-is-long-enough'
    );
    assert.deepEqual(replay, created);
    assert.equal(
      (await rotated.status(created.checkoutId, created.checkoutToken)).state,
      'awaiting-approval'
    );
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'create').length, 1);
  });

  it('reconciles an ambiguous create by replaying the stable PayPal request id', async () => {
    const paypal = new FakePayPal();
    paypal.createError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: true,
      retryable: true,
    });
    const ctx = context({ paypal });
    await assert.rejects(createCheckout(ctx));
    const unknown = await ctx.checkouts.read('checkout-1');
    assert.equal(unknown.document.state, 'reconcile-create-order-unknown');

    paypal.createError = null;
    const replay = await createCheckout(ctx);
    assert.equal(replay.checkoutId, 'checkout-1');
    assert.equal(replay.paypalOrderId, 'order-1');
    assert.equal(paypal.calls.filter(([name]) => name === 'create').length, 2);
    assert.equal(paypal.calls[0][1].requestId, paypal.calls[1][1].requestId);
  });

  it('retries provider success when the order binding write failed', async () => {
    const checkoutDocuments = new MemoryStore();
    const baseCheckouts = new DocumentCheckoutStore(
      checkoutDocuments,
      (value) => Buffer.from(value).toString('base64url'),
      new MemoryDueCheckoutReader(checkoutDocuments)
    );
    let failBinding = true;
    const checkouts = new Proxy(baseCheckouts, {
      get(target, property, receiver) {
        if (property !== 'bindProviderReference') return Reflect.get(target, property, receiver);
        return async (input) => {
          if (failBinding) {
            failBinding = false;
            throw new Error('injected provider-binding write failure');
          }
          return target.bindProviderReference(input);
        };
      },
    });
    const ctx = context({ checkoutDocuments, checkouts });

    await assert.rejects(
      createCheckout(ctx),
      (error) => error instanceof CheckoutServiceError && error.code === 'provider-unavailable'
    );
    const pending = await ctx.checkouts.read('checkout-1');
    assert.equal(pending.document.state, 'reconcile-create-order-unknown');
    assert.equal(pending.document.lastFailure.code, 'provider-binding-persistence');
    assert.equal(pending.document.lastFailure.retryable, true);

    const recovered = await createCheckout(ctx);
    assert.equal(recovered.state, 'awaiting-approval');
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'create').length, 2);
    assert.equal(ctx.paypal.calls[0][1].requestId, ctx.paypal.calls[1][1].requestId);
  });

  it('classifies a provider reference collision separately from PayPal fact mismatch', async () => {
    const ctx = context();
    await ctx.checkouts.bindProviderReference({
      referenceKind: 'order',
      referenceId: 'order-1',
      checkoutId: 'checkout-other',
      nowIso: T0,
    });

    await assert.rejects(
      createCheckout(ctx),
      (error) => error instanceof CheckoutServiceError && error.code === 'manual-review'
    );
    const stored = await ctx.checkouts.read('checkout-1');
    assert.equal(stored.document.state, 'manual-review-create-unknown');
    assert.equal(stored.document.lastFailure.code, 'provider-binding-conflict');
    assert.equal(stored.document.lastFailure.retryable, false);
  });

  it('recovers a durable idempotency claim whose checkout create crashed', async () => {
    const checkoutDocuments = new MemoryStore();
    const checkouts = new DocumentCheckoutStore(
      checkoutDocuments,
      (value) => Buffer.from(value).toString('base64url'),
      new MemoryDueCheckoutReader(checkoutDocuments)
    );
    const keyHash = createHmac('sha256', SECRETS.idempotencyHmacKeys.v1)
      .update('store\0store-1\0idempotency\0idempotency-key-that-is-long-enough')
      .digest('base64url');
    const requestFingerprint = createHash('sha256')
      .update(JSON.stringify({ items: [['p-1', 1]] }))
      .digest('base64url');
    await checkouts.claimIdempotency({
      keyHash,
      keyVersion: 'v1',
      requestFingerprint,
      checkoutId: 'checkout-recovered',
      nowIso: T0,
    });
    const ctx = context({ checkoutDocuments });
    const recovered = await createCheckout(ctx);
    assert.equal(recovered.checkoutId, 'checkout-recovered');
    assert.equal(
      (await ctx.checkouts.read('checkout-recovered')).document.state,
      'awaiting-approval'
    );
  });

  it('conflicts a changed-body idempotency replay and never mints a second order', async () => {
    const ctx = context();
    await createCheckout(ctx);
    await assert.rejects(
      ctx.service.create(
        { items: [{ productId: 'p-1', quantity: 2 }] },
        'idempotency-key-that-is-long-enough'
      ),
      (error) => error instanceof CheckoutServiceError && error.code === 'idempotency-conflict'
    );
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'create').length, 1);
  });
});

describe('checkout orchestration completion', () => {
  it('authorizes, reserves, captures, commits inventory and persists one replayable receipt', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    const completed = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(completed.state, 'completed');
    assert.equal(completed.receipt.paypalCaptureId, 'capture-1');
    const storedProduct = await ctx.products.read('p-1');
    assert.equal(storedProduct.document.stock, 4);
    assert.equal(storedProduct.document.checkoutMarkers['checkout-1'].state, 'committed');
    assert.equal((await ctx.transactions.list()).length, 1);

    const replay = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.deepEqual(replay.receipt, completed.receipt);
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'capture').length, 1);
    assert.equal((await ctx.transactions.list()).length, 1);
  });

  it('does not authorize before PayPal reports customer approval', async () => {
    const paypal = new FakePayPal();
    paypal.orderLookup = order('CREATED', undefined);
    const ctx = context({ paypal });
    const created = await createCheckout(ctx);

    const pending = await ctx.service.complete(created.checkoutId, created.checkoutToken);

    assert.equal(pending.state, 'awaiting-approval');
    assert.equal(paypal.calls.filter(([name]) => name === 'authorize').length, 0);
    assert.equal(
      (await ctx.checkouts.read(created.checkoutId)).document.state,
      'awaiting-approval'
    );

    paypal.orderLookup = order('APPROVED', undefined);
    const completed = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(completed.state, 'completed');
    assert.equal(paypal.calls.filter(([name]) => name === 'authorize').length, 1);
  });

  it('retries approval retrieval failures without creating an authorization boundary', async () => {
    const paypal = new FakePayPal();
    paypal.orderLookupError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: false,
      retryable: true,
    });
    const ctx = context({ paypal });
    const created = await createCheckout(ctx);

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'provider-unavailable'
    );

    const pending = await ctx.checkouts.read(created.checkoutId);
    assert.equal(pending.document.state, 'awaiting-approval');
    assert.equal(pending.document.lastFailure.retryable, true);
    assert.equal(paypal.calls.filter(([name]) => name === 'authorize').length, 0);
  });

  it('requires the separate checkout capability without revealing checkout existence', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    await assert.rejects(
      ctx.service.status(created.checkoutId, 'another-token-that-is-long-enough'),
      (error) => error.code === 'not-found'
    );
    await assert.rejects(
      ctx.service.status('missing-checkout', created.checkoutToken),
      (error) => error.code === 'not-found'
    );
    await assert.rejects(ctx.service.status('', created.checkoutToken), (error) => {
      return error.code === 'not-found';
    });
    await assert.rejects(ctx.service.status(created.checkoutId, ''), (error) => {
      return error.code === 'not-found';
    });
  });

  it('retains reservations and reconciles an ambiguous captured response through PayPal retrieval', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    ctx.paypal.captureError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: true,
      retryable: true,
    });
    await assert.rejects(ctx.service.complete(created.checkoutId, created.checkoutToken));
    const unknown = await ctx.checkouts.read(created.checkoutId);
    assert.equal(unknown.document.state, 'reconcile-capture-unknown');
    assert.equal(
      (await ctx.products.read('p-1')).document.checkoutMarkers['checkout-1'].state,
      'reserved'
    );

    ctx.paypal.authorizationLookup = authorization({
      status: 'CAPTURED',
      relatedCaptureId: 'capture-1',
    });
    ctx.paypal.captureError = null;
    const completed = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(completed.state, 'completed');
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'capture').length, 1);
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'get-capture').length, 1);
  });

  it('recovers provider capture success when its binding write failed', async () => {
    const checkoutDocuments = new MemoryStore();
    const baseCheckouts = new DocumentCheckoutStore(
      checkoutDocuments,
      (value) => Buffer.from(value).toString('base64url'),
      new MemoryDueCheckoutReader(checkoutDocuments)
    );
    let failCaptureBinding = true;
    const checkouts = new Proxy(baseCheckouts, {
      get(target, property, receiver) {
        if (property !== 'bindProviderReference') return Reflect.get(target, property, receiver);
        return async (input) => {
          if (failCaptureBinding && input.referenceKind === 'capture') {
            failCaptureBinding = false;
            throw new Error('injected capture-binding write failure');
          }
          return target.bindProviderReference(input);
        };
      },
    });
    const ctx = context({ checkoutDocuments, checkouts });
    const created = await createCheckout(ctx);

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'provider-unavailable'
    );
    const pending = await ctx.checkouts.read(created.checkoutId);
    assert.equal(pending.document.state, 'reconcile-capture-unknown');
    assert.equal(pending.document.paypalCaptureId, null);
    assert.equal(pending.document.lastFailure.code, 'provider-binding-persistence');
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'capture').length, 1);

    ctx.paypal.authorizationLookup = authorization({
      status: 'CAPTURED',
      relatedCaptureId: 'capture-1',
    });
    const completed = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(completed.state, 'completed');
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'capture').length, 1);
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'get-capture').length, 1);
  });

  it('retries void retrieval failures without releasing reservations', async () => {
    const paypal = new FakePayPal();
    const products = new MemoryStore([product(), product({ id: 'p-2', name: 'Milk', stock: 1 })]);
    const ctx = context({ paypal, products });
    const created = await ctx.service.create(
      {
        items: [
          { productId: 'p-1', quantity: 1 },
          { productId: 'p-2', quantity: 1 },
        ],
      },
      'idempotency-key-that-is-long-enough'
    );
    const p2 = await products.read('p-2');
    await products.write({ ...p2.document, isActive: false }, p2.rev);
    paypal.voidError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: true,
      retryable: true,
    });

    await assert.rejects(ctx.service.complete(created.checkoutId, created.checkoutToken));
    paypal.voidError = null;
    paypal.authorizationLookupError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: false,
      retryable: true,
    });
    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'provider-unavailable'
    );

    const pending = await ctx.checkouts.read(created.checkoutId);
    assert.equal(pending.document.state, 'reconcile-void-unknown');
    assert.equal(pending.document.lastFailure.code, 'paypal-provider-unavailable');
    assert.equal(pending.document.lastFailure.retryable, true);
    assert.equal(
      (await products.read('p-1')).document.checkoutMarkers[created.checkoutId].state,
      'reserved'
    );
    assert.equal(paypal.calls.filter(([name]) => name === 'capture').length, 0);
  });

  it('retries capture retrieval failure without issuing another capture mutation', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    ctx.paypal.captureError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: true,
      retryable: true,
    });
    await assert.rejects(ctx.service.complete(created.checkoutId, created.checkoutToken));
    ctx.paypal.authorizationLookup = authorization({
      status: 'CAPTURED',
      relatedCaptureId: 'capture-1',
    });
    ctx.paypal.captureError = null;
    ctx.paypal.captureLookupError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: false,
      retryable: true,
    });

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'provider-unavailable'
    );
    const pending = await ctx.checkouts.read(created.checkoutId);
    assert.equal(pending.document.state, 'reconcile-capture-unknown');
    assert.equal(pending.document.lastFailure.code, 'paypal-provider-unavailable');
    assert.equal(pending.document.lastFailure.retryable, true);
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'capture').length, 1);

    ctx.paypal.captureLookupError = null;
    const completed = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(completed.state, 'completed');
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'capture').length, 1);
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'get-capture').length, 2);
  });

  it('recovers after binding a capture but exhausting the checkout CAS', async () => {
    const checkoutDocuments = new MemoryStore();
    const baseCheckouts = new DocumentCheckoutStore(
      checkoutDocuments,
      (value) => Buffer.from(value).toString('base64url'),
      new MemoryDueCheckoutReader(checkoutDocuments)
    );
    let failCaptureCas = 5;
    const checkouts = new Proxy(baseCheckouts, {
      get(target, property, receiver) {
        if (property !== 'compareAndSwap') return Reflect.get(target, property, receiver);
        return async (checkoutId, document, revision, leaseFence) => {
          if (failCaptureCas > 0 && document.state === 'captured-pending-commit') {
            failCaptureCas -= 1;
            return 'conflict';
          }
          return target.compareAndSwap(checkoutId, document, revision, leaseFence);
        };
      },
    });
    const ctx = context({ checkoutDocuments, checkouts });
    const created = await createCheckout(ctx);

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'conflict'
    );
    const pending = await ctx.checkouts.read(created.checkoutId);
    assert.equal(pending.document.state, 'reconcile-capture-unknown');
    assert.equal(pending.document.paypalCaptureId, null);
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'capture').length, 1);

    ctx.paypal.authorizationLookup = authorization({
      status: 'CAPTURED',
      relatedCaptureId: 'capture-1',
    });
    const completed = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(completed.state, 'completed');
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'capture').length, 1);
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'get-capture').length, 1);
  });

  it('terminalizes a deterministic transaction binding conflict after capture', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    await ctx.transactions.create({
      id: checkoutTransactionId(created.checkoutId),
      kind: 'checkout-sale',
      type: 'sale',
      checkoutId: created.checkoutId,
      paypalCaptureId: 'capture-other',
      storeId: CONFIG.storeId,
      quote: created.quote,
      timestamp: T0,
    });

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'manual-review'
    );

    const stored = await ctx.checkouts.read(created.checkoutId);
    assert.equal(stored.document.state, 'manual-review-captured');
    assert.equal(stored.document.lastFailure.code, 'transaction-binding-conflict');
    assert.equal(stored.document.lastFailure.retryable, false);
    assert.equal(stored.document.nextActionAt, null);
    assert.equal(stored.document.lease, null);
    assert.equal((await ctx.products.read('p-1')).document.stock, 4);
    assert.equal((await ctx.transactions.list())[0].paypalCaptureId, 'capture-other');
  });

  it('terminalizes a malformed deterministic transaction after capture', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    await ctx.transactions.create({
      id: checkoutTransactionId(created.checkoutId),
      type: 'sale',
      productId: 'legacy-product',
    });

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'manual-review'
    );

    const stored = await ctx.checkouts.read(created.checkoutId);
    assert.equal(stored.document.state, 'manual-review-captured');
    assert.equal(stored.document.lastFailure.code, 'transaction-invalid-record');
    assert.equal(stored.document.lastFailure.retryable, false);
    assert.equal(stored.document.nextActionAt, null);
    assert.equal(stored.document.lease, null);
    assert.equal((await ctx.products.read('p-1')).document.stock, 4);
  });

  it('terminalizes a missing product discovered during captured commit', async () => {
    const products = new MemoryStore([product()]);
    const paypal = new FakePayPal();
    paypal.captureAuthorization = async function (authorizationId, requestId) {
      this.calls.push(['capture', authorizationId, requestId]);
      const current = await products.read('p-1');
      await products.remove('p-1', current.rev);
      return paymentForInput(capture(), this.createdInput);
    };
    const ctx = context({ paypal, products });
    const created = await createCheckout(ctx);

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'manual-review'
    );

    const stored = await ctx.checkouts.read(created.checkoutId);
    assert.equal(stored.document.state, 'manual-review-captured');
    assert.equal(stored.document.lastFailure.code, 'product-missing');
    assert.equal(stored.document.lastFailure.retryable, false);
    assert.equal(stored.document.nextActionAt, null);
    assert.equal(stored.document.lease, null);
    assert.equal(paypal.calls.filter(([name]) => name === 'capture').length, 1);
  });

  it('terminalizes corrupt inventory discovered during captured commit', async () => {
    const products = new MemoryStore([product()]);
    const paypal = new FakePayPal();
    paypal.captureAuthorization = async function (authorizationId, requestId) {
      this.calls.push(['capture', authorizationId, requestId]);
      const current = await products.read('p-1');
      await products.write(
        {
          ...current.document,
          checkoutMarkers: {
            'checkout-1': { state: 'reserved', quantity: 1, reservedAt: 'not-a-timestamp' },
          },
        },
        current.rev
      );
      return paymentForInput(capture(), this.createdInput);
    };
    const ctx = context({ paypal, products });
    const created = await createCheckout(ctx);

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'manual-review'
    );

    const stored = await ctx.checkouts.read(created.checkoutId);
    assert.equal(stored.document.state, 'manual-review-captured');
    assert.equal(stored.document.lastFailure.code, 'inventory-invalid-inventory');
    assert.equal(stored.document.lastFailure.retryable, false);
    assert.equal(stored.document.nextActionAt, null);
    assert.equal(stored.document.lease, null);
  });

  it('voids before releasing partial reservations when a later product disappears', async () => {
    const paypal = new FakePayPal();
    const products = new MemoryStore([product(), product({ id: 'p-2', name: 'Milk', stock: 1 })]);
    const ctx = context({ paypal, products });
    const created = await ctx.service.create(
      {
        items: [
          { productId: 'p-1', quantity: 1 },
          { productId: 'p-2', quantity: 1 },
        ],
      },
      'idempotency-key-that-is-long-enough'
    );
    const p2 = await products.read('p-2');
    await products.write({ ...p2.document, isActive: false }, p2.rev);

    const result = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(result.state, 'voided');
    assert.deepEqual(
      paypal.calls.map(([name]) => name),
      ['create', 'get-order', 'authorize', 'void']
    );
    assert.equal((await products.read('p-1')).document.checkoutMarkers['checkout-1'], undefined);
  });

  it('terminalizes a missing product during release after confirmed non-capturability', async () => {
    const products = new MemoryStore([product(), product({ id: 'p-2', name: 'Milk', stock: 1 })]);
    const paypal = new FakePayPal();
    paypal.voidAuthorization = async function (authorizationId, requestId) {
      this.calls.push(['void', authorizationId, requestId]);
      const first = await products.read('p-1');
      await products.remove('p-1', first.rev);
      return paymentForInput(authorization({ status: 'VOIDED' }), this.createdInput);
    };
    const ctx = context({ paypal, products });
    const created = await ctx.service.create(
      {
        items: [
          { productId: 'p-1', quantity: 1 },
          { productId: 'p-2', quantity: 1 },
        ],
      },
      'idempotency-key-that-is-long-enough'
    );
    const p2 = await products.read('p-2');
    await products.write({ ...p2.document, isActive: false }, p2.rev);

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'manual-review'
    );

    const stored = await ctx.checkouts.read(created.checkoutId);
    assert.equal(stored.document.state, 'manual-review-authorized');
    assert.equal(stored.document.lastFailure.code, 'product-missing');
    assert.equal(stored.document.lastFailure.retryable, false);
    assert.equal(stored.document.nextActionAt, null);
    assert.equal(stored.document.lease, null);
    assert.deepEqual(
      paypal.calls.map(([name]) => name),
      ['create', 'get-order', 'authorize', 'void']
    );
    assert.equal(paypal.calls.filter(([name]) => name === 'capture').length, 0);
  });

  it('terminalizes corrupt inventory during release after confirmed non-capturability', async () => {
    const products = new MemoryStore([product(), product({ id: 'p-2', name: 'Milk', stock: 1 })]);
    const paypal = new FakePayPal();
    paypal.voidAuthorization = async function (authorizationId, requestId) {
      this.calls.push(['void', authorizationId, requestId]);
      const first = await products.read('p-1');
      await products.write(
        {
          ...first.document,
          checkoutMarkers: {
            'checkout-1': { state: 'reserved', quantity: 1, reservedAt: 'not-a-timestamp' },
          },
        },
        first.rev
      );
      return paymentForInput(authorization({ status: 'VOIDED' }), this.createdInput);
    };
    const ctx = context({ paypal, products });
    const created = await ctx.service.create(
      {
        items: [
          { productId: 'p-1', quantity: 1 },
          { productId: 'p-2', quantity: 1 },
        ],
      },
      'idempotency-key-that-is-long-enough'
    );
    const p2 = await products.read('p-2');
    await products.write({ ...p2.document, isActive: false }, p2.rev);

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'manual-review'
    );

    const stored = await ctx.checkouts.read(created.checkoutId);
    assert.equal(stored.document.state, 'manual-review-authorized');
    assert.equal(stored.document.lastFailure.code, 'inventory-invalid-inventory');
    assert.equal(stored.document.lastFailure.retryable, false);
    assert.equal(stored.document.nextActionAt, null);
    assert.equal(stored.document.lease, null);
  });

  it('voids before releasing partial reservations when a later item is unavailable', async () => {
    const paypal = new FakePayPal();
    const products = new MemoryStore([product(), product({ id: 'p-2', name: 'Milk', stock: 1 })]);
    const ctx = context({ paypal, products });
    const created = await ctx.service.create(
      {
        items: [
          { productId: 'p-1', quantity: 1 },
          { productId: 'p-2', quantity: 1 },
        ],
      },
      'idempotency-key-that-is-long-enough'
    );
    const p2 = await products.read('p-2');
    await products.write(
      {
        ...p2.document,
        checkoutMarkers: { other: { state: 'reserved', quantity: 1, reservedAt: T0 } },
      },
      p2.rev
    );

    const result = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(result.state, 'voided');
    assert.deepEqual(
      paypal.calls.map(([name]) => name),
      ['create', 'get-order', 'authorize', 'void']
    );
    assert.equal((await products.read('p-1')).document.checkoutMarkers['checkout-1'], undefined);
    assert.equal((await products.read('p-2')).document.checkoutMarkers.other.state, 'reserved');
  });
});

describe('checkout reconciliation fencing and recovery', () => {
  it('reports busy without making provider calls when another owner holds the lease', async () => {
    const ctx = context();
    const created = await createCheckout(ctx);
    await ctx.checkouts.tryAcquireLease({
      checkoutId: created.checkoutId,
      ownerId: 'worker-a',
      leaseId: 'lease-a',
      nowIso: T0,
      expiresAtIso: '2026-09-18T12:01:00.000Z',
    });
    const callsBefore = ctx.paypal.calls.length;

    const result = await ctx.service.reconcile(created.checkoutId, {
      ownerId: 'worker-b',
      leaseId: 'lease-b',
    });

    assert.deepEqual(result, { outcome: 'busy' });
    assert.equal(ctx.paypal.calls.length, callsBefore);
  });

  it('takes over an expired lease and completes with the worker lease', async () => {
    let now = T0;
    const ctx = context({ nowIso: () => now });
    const created = await createCheckout(ctx);
    await ctx.checkouts.tryAcquireLease({
      checkoutId: created.checkoutId,
      ownerId: 'worker-a',
      leaseId: 'lease-a',
      nowIso: T0,
      expiresAtIso: '2026-09-18T12:00:01.000Z',
    });
    now = '2026-09-18T12:00:02.000Z';

    const result = await ctx.service.reconcile(created.checkoutId, {
      ownerId: 'worker-b',
      leaseId: 'lease-b',
    });

    assert.equal(result.outcome, 'reconciled');
    assert.equal(result.status.state, 'completed');
    assert.equal((await ctx.checkouts.read(created.checkoutId)).document.lease, null);
  });

  it('does not persist provider success after losing the lease during the call', async () => {
    let now = T0;
    let ctx;
    const paypal = new FakePayPal();
    paypal.authorizeOrder = async function (orderId, requestId) {
      this.calls.push(['authorize', orderId, requestId]);
      now = '2026-09-18T12:00:31.000Z';
      const takeover = await ctx.checkouts.tryAcquireLease({
        checkoutId: 'checkout-1',
        ownerId: 'worker-b',
        leaseId: 'lease-b',
        nowIso: now,
        expiresAtIso: '2026-09-18T12:01:01.000Z',
      });
      assert.equal(takeover.outcome, 'acquired');
      return order('COMPLETED', authorization(), this.createdInput);
    };
    ctx = context({ paypal, nowIso: () => now });
    const created = await createCheckout(ctx);

    await assert.rejects(
      ctx.service.reconcile(created.checkoutId, {
        ownerId: 'worker-a',
        leaseId: 'lease-a',
      }),
      (error) => error instanceof CheckoutServiceError && error.code === 'conflict'
    );
    const stored = await ctx.checkouts.read(created.checkoutId);
    assert.equal(stored.document.state, 'authorize-requested');
    assert.deepEqual(stored.document.lease, {
      ownerId: 'worker-b',
      leaseId: 'lease-b',
      expiresAt: '2026-09-18T12:01:01.000Z',
    });
    assert.equal(stored.document.paypalAuthorizationId, null);
  });

  it('persists PayPal fact mismatches in terminal provenance-specific manual review', async () => {
    const paypal = new FakePayPal();
    paypal.authorizeOrder = async function (orderId, requestId) {
      this.calls.push(['authorize', orderId, requestId]);
      return order(
        'COMPLETED',
        authorization({ payeeMerchantId: 'merchant-other' }),
        this.createdInput
      );
    };
    const ctx = context({ paypal });
    const created = await createCheckout(ctx);

    await assert.rejects(
      ctx.service.complete(created.checkoutId, created.checkoutToken),
      (error) => error instanceof CheckoutServiceError && error.code === 'manual-review'
    );
    const stored = await ctx.checkouts.read(created.checkoutId);
    assert.equal(stored.document.state, 'manual-review-authorize-unknown');
    assert.equal(stored.document.lastFailure.code, 'paypal-fact-merchant');
    assert.equal(stored.document.lastFailure.retryable, false);
    assert.equal(stored.document.nextActionAt, null);
    assert.equal(stored.document.lease, null);
  });

  it('recovers an ambiguous authorization before expiry with the stable request id', async () => {
    const paypal = new FakePayPal();
    paypal.authorizeError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: true,
      retryable: true,
    });
    paypal.orderLookup = order('APPROVED', undefined);
    const ctx = context({ paypal });
    const created = await createCheckout(ctx);

    await assert.rejects(ctx.service.complete(created.checkoutId, created.checkoutToken));
    assert.equal(
      (await ctx.checkouts.read(created.checkoutId)).document.state,
      'reconcile-authorize-unknown'
    );
    paypal.authorizeError = null;
    const completed = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(completed.state, 'completed');
    const authorizeCalls = paypal.calls.filter(([name]) => name === 'authorize');
    assert.equal(authorizeCalls.length, 2);
    assert.equal(authorizeCalls[0][2], authorizeCalls[1][2]);
  });

  it('expires an awaiting checkout exactly at the deadline without authorizing late approval', async () => {
    let now = T0;
    const paypal = new FakePayPal();
    paypal.orderLookup = order('APPROVED', undefined);
    const ctx = context({ paypal, nowIso: () => now });
    const created = await createCheckout(ctx);
    now = '2026-09-18T12:30:00.000Z';

    const expired = await ctx.service.reconcile(created.checkoutId, {
      ownerId: 'worker-expiry',
      leaseId: 'lease-expiry',
    });

    assert.equal(expired.outcome, 'reconciled');
    assert.equal(expired.status.state, 'expired');
    assert.equal(paypal.calls.filter(([name]) => name === 'authorize').length, 0);
  });

  it('may authorize an approved order immediately before the deadline', async () => {
    let now = T0;
    const paypal = new FakePayPal();
    const ctx = context({ paypal, nowIso: () => now });
    const created = await createCheckout(ctx);
    now = '2026-09-18T12:29:59.999Z';

    const completed = await ctx.service.reconcile(created.checkoutId, {
      ownerId: 'worker-before-expiry',
      leaseId: 'lease-before-expiry',
    });

    assert.equal(completed.outcome, 'reconciled');
    assert.equal(completed.status.state, 'completed');
    assert.equal(paypal.calls.filter(([name]) => name === 'authorize').length, 1);
  });

  it('does not authorize when approval retrieval crosses the deadline', async () => {
    let now = T0;
    const paypal = new FakePayPal();
    const getOrder = paypal.getOrder.bind(paypal);
    paypal.getOrder = async (orderId) => {
      const approved = await getOrder(orderId);
      now = '2026-09-18T12:30:00.000Z';
      return approved;
    };
    const ctx = context({ paypal, nowIso: () => now });
    const created = await createCheckout(ctx);
    now = '2026-09-18T12:29:59.999Z';

    const expired = await ctx.service.reconcile(created.checkoutId, {
      ownerId: 'worker-crossing-expiry',
      leaseId: 'lease-crossing-expiry',
    });

    assert.equal(expired.outcome, 'reconciled');
    assert.equal(expired.status.state, 'expired');
    assert.equal(paypal.calls.filter(([name]) => name === 'authorize').length, 0);
    assert.equal((await ctx.checkouts.read(created.checkoutId)).document.state, 'expired');
  });

  it('expires an unknown authorization only after retrieval confirms no authorization at expiry', async () => {
    let now = T0;
    const paypal = new FakePayPal();
    paypal.authorizeError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: true,
      retryable: true,
    });
    paypal.orderLookup = order('APPROVED', undefined);
    const ctx = context({ paypal, nowIso: () => now });
    const created = await createCheckout(ctx);

    await assert.rejects(ctx.service.complete(created.checkoutId, created.checkoutToken));
    now = '2026-09-18T12:30:00.000Z';
    const expired = await ctx.service.reconcile(created.checkoutId, {
      ownerId: 'worker-expiry',
      leaseId: 'lease-expiry',
    });
    assert.equal(expired.outcome, 'reconciled');
    assert.equal(expired.status.state, 'expired');
    assert.equal((await ctx.checkouts.read(created.checkoutId)).document.lease, null);
    assert.equal(paypal.calls.filter(([name]) => name === 'authorize').length, 1);
  });

  it('accepts an authorization found after the deadline when it was already requested', async () => {
    let now = T0;
    const paypal = new FakePayPal();
    paypal.authorizeError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: true,
      retryable: true,
    });
    const ctx = context({ paypal, nowIso: () => now });
    const created = await createCheckout(ctx);
    await assert.rejects(ctx.service.complete(created.checkoutId, created.checkoutToken));
    now = '2026-09-18T12:30:00.000Z';
    paypal.orderLookup = order('COMPLETED', authorization());

    const completed = await ctx.service.reconcile(created.checkoutId, {
      ownerId: 'worker-recover-after-expiry',
      leaseId: 'lease-recover-after-expiry',
    });

    assert.equal(completed.outcome, 'reconciled');
    assert.equal(completed.status.state, 'completed');
    assert.equal(paypal.calls.filter(([name]) => name === 'authorize').length, 1);
  });

  it('escalates bounded ambiguous provider retries with exponential scheduling', async () => {
    let nowMs = Date.parse(T0);
    const paypal = new FakePayPal();
    paypal.authorizeError = new PayPalGatewayError('provider-unavailable', {
      ambiguous: true,
      retryable: true,
    });
    paypal.orderLookup = order('APPROVED', undefined);
    const ctx = context({
      paypal,
      nowIso: () => new Date(nowMs).toISOString(),
      newId: (() => {
        const ids = ['checkout-1'];
        let lease = 0;
        return () => ids.shift() ?? `lease-${++lease}`;
      })(),
    });
    const created = await createCheckout(ctx);
    let previousDelay = 0;

    for (let attempt = 1; attempt <= 8; attempt += 1) {
      await assert.rejects(ctx.service.complete(created.checkoutId, created.checkoutToken));
      const stored = await ctx.checkouts.read(created.checkoutId);
      assert.equal(stored.document.attempts, attempt);
      if (attempt < 8) {
        assert.equal(stored.document.state, 'reconcile-authorize-unknown');
        const delay = Date.parse(stored.document.nextActionAt) - nowMs;
        assert.ok(delay >= previousDelay);
        previousDelay = delay;
      } else {
        assert.equal(stored.document.state, 'manual-review-authorize-unknown');
        assert.equal(stored.document.nextActionAt, null);
        assert.equal(stored.document.lease, null);
      }
      nowMs += 1;
    }
  });

  it('commits two products exactly once after a crash between product writes', async () => {
    const baseProducts = new MemoryStore([
      product(),
      product({ id: 'p-2', name: 'Milk', stock: 3 }),
    ]);
    let failSecondCommit = true;
    const products = {
      list: () => baseProducts.list(),
      read: (id) => baseProducts.read(id),
      create: (document) => baseProducts.create(document),
      remove: (id, revision) => baseProducts.remove(id, revision),
      async write(document, revision) {
        if (
          failSecondCommit &&
          document.id === 'p-2' &&
          document.checkoutMarkers?.['checkout-1']?.state === 'committed'
        ) {
          failSecondCommit = false;
          throw new Error('injected product-write crash');
        }
        return baseProducts.write(document, revision);
      },
    };
    const ctx = context({ products });
    const created = await ctx.service.create(
      {
        items: [
          { productId: 'p-1', quantity: 1 },
          { productId: 'p-2', quantity: 2 },
        ],
      },
      'idempotency-key-that-is-long-enough'
    );

    await assert.rejects(ctx.service.complete(created.checkoutId, created.checkoutToken));
    const firstProduct = await baseProducts.read('p-1');
    const secondProduct = await baseProducts.read('p-2');
    assert.equal(firstProduct.document.stock, 4);
    assert.equal(firstProduct.document.checkoutMarkers['checkout-1'].state, 'committed');
    assert.equal(secondProduct.document.stock, 3);
    assert.equal(secondProduct.document.checkoutMarkers['checkout-1'].state, 'reserved');
    assert.equal((await ctx.transactions.list()).length, 0);
    assert.equal(
      (await ctx.checkouts.read(created.checkoutId)).document.state,
      'reconcile-captured'
    );

    const completed = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(completed.state, 'completed');
    assert.equal((await baseProducts.read('p-1')).document.stock, 4);
    assert.equal((await baseProducts.read('p-2')).document.stock, 1);
    assert.equal(
      (await baseProducts.read('p-1')).document.checkoutMarkers['checkout-1'].state,
      'committed'
    );
    assert.equal(
      (await baseProducts.read('p-2')).document.checkoutMarkers['checkout-1'].state,
      'committed'
    );
    assert.equal((await ctx.transactions.list()).length, 1);
    assert.equal(completed.receipt.transactionId, (await ctx.transactions.list())[0].id);
    assert.equal(ctx.paypal.calls.filter(([name]) => name === 'capture').length, 1);
  });

  it('finishes exactly once after crashes following product commit and transaction creation', async () => {
    let failCheckoutCas = 5;
    const checkoutDocuments = new MemoryStore();
    const baseCheckouts = new DocumentCheckoutStore(
      checkoutDocuments,
      (value) => Buffer.from(value).toString('base64url'),
      new MemoryDueCheckoutReader(checkoutDocuments)
    );
    const checkouts = new Proxy(baseCheckouts, {
      get(target, property, receiver) {
        if (property !== 'compareAndSwap') return Reflect.get(target, property, receiver);
        return async (checkoutId, document, revision, leaseFence) => {
          if (failCheckoutCas > 0 && document.state === 'completed') {
            failCheckoutCas -= 1;
            return 'conflict';
          }
          return target.compareAndSwap(checkoutId, document, revision, leaseFence);
        };
      },
    });
    const ctx = context({ checkoutDocuments, checkouts });
    const created = await createCheckout(ctx);

    await assert.rejects(ctx.service.complete(created.checkoutId, created.checkoutToken));
    assert.equal((await ctx.products.read('p-1')).document.stock, 4);
    assert.equal((await ctx.transactions.list()).length, 1);
    assert.equal(
      (await ctx.checkouts.read(created.checkoutId)).document.state,
      'reconcile-captured'
    );

    const completed = await ctx.service.complete(created.checkoutId, created.checkoutToken);
    assert.equal(completed.state, 'completed');
    assert.equal((await ctx.products.read('p-1')).document.stock, 4);
    assert.equal((await ctx.transactions.list()).length, 1);
  });
});
