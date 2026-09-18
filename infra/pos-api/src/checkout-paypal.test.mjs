import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  PayPalGatewayError,
  PayPalSdkGateway,
  assertPayPalAuthorization,
  assertPayPalCapture,
  assertPayPalOrder,
} from './checkout-paypal.ts';

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

function response(result) {
  return { result, statusCode: 200, headers: {}, body: '' };
}

function purchaseUnit(overrides = {}) {
  return {
    referenceId: 'checkout-1',
    customId: 'checkout-1',
    invoiceId: 'checkout-1',
    amount: { currencyCode: 'USD', value: '3.26' },
    payee: { merchantId: 'merchant-1' },
    payments: {},
    ...overrides,
  };
}

function order(overrides = {}) {
  return {
    id: 'order-1',
    intent: 'AUTHORIZE',
    status: 'CREATED',
    purchaseUnits: [purchaseUnit()],
    ...overrides,
  };
}

function authorization(overrides = {}) {
  return {
    id: 'authorization-1',
    status: 'CREATED',
    amount: { currencyCode: 'USD', value: '3.26' },
    customId: 'checkout-1',
    invoiceId: 'checkout-1',
    payee: { merchantId: 'merchant-1' },
    ...overrides,
  };
}

function capture(overrides = {}) {
  return {
    id: 'capture-1',
    status: 'COMPLETED',
    amount: { currencyCode: 'USD', value: '3.26' },
    customId: 'checkout-1',
    invoiceId: 'checkout-1',
    payee: { merchantId: 'merchant-1' },
    finalCapture: true,
    ...overrides,
  };
}

function controllers(overrides = {}) {
  const calls = [];
  return {
    calls,
    value: {
      orders: {
        async createOrder(input, options) {
          calls.push(['createOrder', input, options]);
          return response(order());
        },
        async getOrder(input, options) {
          calls.push(['getOrder', input, options]);
          return response(order());
        },
        async authorizeOrder(input, options) {
          calls.push(['authorizeOrder', input, options]);
          return response(
            order({
              status: 'COMPLETED',
              purchaseUnits: [purchaseUnit({ payments: { authorizations: [authorization()] } })],
            })
          );
        },
      },
      payments: {
        async getAuthorizedPayment(input, options) {
          calls.push(['getAuthorizedPayment', input, options]);
          return response(authorization());
        },
        async captureAuthorizedPayment(input, options) {
          calls.push(['captureAuthorizedPayment', input, options]);
          return response(capture());
        },
        async getCapturedPayment(input, options) {
          calls.push(['getCapturedPayment', input, options]);
          return response(capture());
        },
        async voidPayment(input, options) {
          calls.push(['voidPayment', input, options]);
          return response(authorization({ status: 'VOIDED' }));
        },
      },
      ...overrides,
    },
  };
}

const expected = {
  checkoutId: 'checkout-1',
  quote,
  expectedMerchantId: 'merchant-1',
};

describe('PayPal SDK gateway', () => {
  it('creates an AUTHORIZE order using only the authoritative quote and stable bindings', async () => {
    const fake = controllers();
    const gateway = new PayPalSdkGateway(fake.value, 1_000);
    const mapped = await gateway.createOrder({ ...expected, requestId: 'request-create' });

    assert.equal(mapped.id, 'order-1');
    const [, input, options] = fake.calls[0];
    assert.equal(input.paypalRequestId, 'request-create');
    assert.equal(input.prefer, 'return=representation');
    assert.deepEqual(input.body, {
      intent: 'AUTHORIZE',
      purchaseUnits: [
        {
          referenceId: 'checkout-1',
          customId: 'checkout-1',
          invoiceId: 'checkout-1',
          payee: { merchantId: 'merchant-1' },
          amount: {
            currencyCode: 'USD',
            value: '3.26',
            breakdown: {
              itemTotal: { currencyCode: 'USD', value: '3.00' },
              taxTotal: { currencyCode: 'USD', value: '0.26' },
            },
          },
        },
      ],
    });
    assert.ok(options.abortSignal instanceof AbortSignal);
  });

  it('passes stable request ids and final-capture=true to irreversible operations', async () => {
    const fake = controllers();
    const gateway = new PayPalSdkGateway(fake.value, 1_000);
    await gateway.authorizeOrder('order-1', 'request-authorize');
    await gateway.captureAuthorization('authorization-1', 'request-capture');
    await gateway.voidAuthorization('authorization-1', 'request-void');

    assert.equal(fake.calls[0][1].paypalRequestId, 'request-authorize');
    assert.deepEqual(fake.calls[1][1], {
      authorizationId: 'authorization-1',
      paypalRequestId: 'request-capture',
      prefer: 'return=representation',
      body: { finalCapture: true },
    });
    assert.equal(fake.calls[2][1].paypalRequestId, 'request-void');
  });

  it('maps SDK resources into provider-neutral snapshots without payer data or raw bodies', async () => {
    const fake = controllers();
    const gateway = new PayPalSdkGateway(fake.value, 1_000);
    const mapped = await gateway.authorizeOrder('order-1', 'request-authorize');

    assert.deepEqual(mapped.purchaseUnits[0].authorizations[0], {
      id: 'authorization-1',
      status: 'CREATED',
      amount: { currencyCode: 'USD', value: '3.26' },
      customId: 'checkout-1',
      invoiceId: 'checkout-1',
      payeeMerchantId: 'merchant-1',
      relatedCaptureId: null,
    });
    assert.equal('payer' in mapped, false);
    assert.equal('body' in mapped, false);
  });

  it('fails closed on malformed provider representations', async () => {
    const fake = controllers({
      orders: {
        async createOrder() {
          return response(order({ purchaseUnits: [] }));
        },
        async getOrder() {
          return response(order());
        },
        async authorizeOrder() {
          return response(order());
        },
      },
    });
    const gateway = new PayPalSdkGateway(fake.value, 1_000);

    await assert.rejects(
      gateway.createOrder({ ...expected, requestId: 'request-create' }),
      (error) =>
        error instanceof PayPalGatewayError &&
        error.code === 'malformed-response' &&
        error.ambiguous === true &&
        error.retryable === false
    );
  });

  it('classifies definitive provider refusal separately from ambiguous mutation failures', async () => {
    const definitive = controllers({
      orders: {
        async createOrder() {
          throw Object.assign(new Error('do not leak'), { statusCode: 422 });
        },
        async getOrder() {
          throw new Error('unused');
        },
        async authorizeOrder() {
          throw new Error('unused');
        },
      },
    });
    const ambiguous = controllers({
      payments: {
        async getAuthorizedPayment() {
          throw new Error('unused');
        },
        async captureAuthorizedPayment() {
          throw Object.assign(new Error('provider body must not leak'), { statusCode: 503 });
        },
        async getCapturedPayment() {
          throw new Error('unused');
        },
        async voidPayment() {
          throw new Error('unused');
        },
      },
    });

    await assert.rejects(
      new PayPalSdkGateway(definitive.value, 1_000).createOrder({
        ...expected,
        requestId: 'request-create',
      }),
      (error) =>
        error instanceof PayPalGatewayError &&
        error.code === 'invalid-request' &&
        error.ambiguous === false &&
        error.retryable === false &&
        !error.message.includes('do not leak')
    );
    await assert.rejects(
      new PayPalSdkGateway(ambiguous.value, 1_000).captureAuthorization(
        'authorization-1',
        'request-capture'
      ),
      (error) =>
        error instanceof PayPalGatewayError &&
        error.code === 'provider-unavailable' &&
        error.ambiguous === true &&
        error.retryable === true &&
        !error.message.includes('provider body')
    );
  });

  it('validates identifiers and requires an explicit positive timeout', async () => {
    const fake = controllers();
    assert.throws(() => new PayPalSdkGateway(fake.value, 0), /timeout/i);
    const gateway = new PayPalSdkGateway(fake.value, 1_000);
    await assert.rejects(gateway.getOrder(''), /orderId is required/i);
    await assert.rejects(gateway.authorizeOrder('order-1', ''), /requestId is required/i);
  });
});

describe('PayPal checkout fact verification', () => {
  it('verifies the order checkout binding, intent, amount, currency, merchant, and status', () => {
    const snapshot = new PayPalSdkGateway(controllers().value, 1_000);
    return snapshot.getOrder('order-1').then((value) => {
      assert.equal(assertPayPalOrder(value, expected, ['CREATED']).id, 'order-1');
      for (const bad of [
        { ...value, intent: 'CAPTURE' },
        { ...value, status: 'VOIDED' },
        { ...value, purchaseUnits: [{ ...value.purchaseUnits[0], customId: 'other' }] },
        {
          ...value,
          purchaseUnits: [
            { ...value.purchaseUnits[0], amount: { currencyCode: 'EUR', value: '3.26' } },
          ],
        },
        {
          ...value,
          purchaseUnits: [
            { ...value.purchaseUnits[0], amount: { currencyCode: 'USD', value: '3.25' } },
          ],
        },
        { ...value, purchaseUnits: [{ ...value.purchaseUnits[0], payeeMerchantId: 'other' }] },
      ]) {
        assert.throws(() => assertPayPalOrder(bad, expected, ['CREATED']), /PayPal order/i);
      }
    });
  });

  it('verifies authorization and capture payment facts, including final capture', () => {
    const expectedAuthorization = {
      ...expected,
      authorizationId: 'authorization-1',
    };
    const expectedCapture = { ...expected, captureId: 'capture-1' };
    const authorizationSnapshot = {
      id: 'authorization-1',
      status: 'CREATED',
      amount: { currencyCode: 'USD', value: '3.26' },
      customId: 'checkout-1',
      invoiceId: 'checkout-1',
      payeeMerchantId: 'merchant-1',
    };
    const captureSnapshot = {
      id: 'capture-1',
      status: 'COMPLETED',
      amount: { currencyCode: 'USD', value: '3.26' },
      customId: 'checkout-1',
      invoiceId: 'checkout-1',
      payeeMerchantId: 'merchant-1',
      finalCapture: true,
    };

    assert.equal(
      assertPayPalAuthorization(authorizationSnapshot, expectedAuthorization, ['CREATED']).id,
      'authorization-1'
    );
    assert.equal(
      assertPayPalCapture(captureSnapshot, expectedCapture, ['COMPLETED']).id,
      'capture-1'
    );
    assert.throws(
      () =>
        assertPayPalAuthorization(
          { ...authorizationSnapshot, id: 'other' },
          expectedAuthorization,
          ['CREATED']
        ),
      /authorization/i
    );
    assert.throws(
      () =>
        assertPayPalCapture({ ...captureSnapshot, finalCapture: false }, expectedCapture, [
          'COMPLETED',
        ]),
      /capture/i
    );
  });
});
