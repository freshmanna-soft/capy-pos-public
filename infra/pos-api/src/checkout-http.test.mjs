import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CheckoutServiceError } from './checkout-service.ts';
import { handleCheckoutHttp, matchCheckoutRoute } from './checkout-http.ts';

function context(overrides = {}) {
  const calls = [];
  const checkout = {
    async create(body, idempotencyKey) {
      calls.push(['create', body, idempotencyKey]);
      return { checkoutId: 'checkout-1', checkoutToken: 'token', state: 'awaiting-approval' };
    },
    async status(checkoutId, checkoutToken) {
      calls.push(['status', checkoutId, checkoutToken]);
      return { checkoutId, state: 'awaiting-approval' };
    },
    async complete(checkoutId, checkoutToken) {
      calls.push(['complete', checkoutId, checkoutToken]);
      return { checkoutId, state: 'completed' };
    },
    ...overrides.checkout,
  };
  return {
    calls,
    deps: {
      checkout,
      rateLimiter: overrides.rateLimiter ?? { consume: () => ({ allowed: true }) },
      rateLimitKey: 'client-key',
    },
  };
}

function request(method, path, overrides = {}) {
  return {
    method,
    path,
    idempotencyKey: overrides.idempotencyKey,
    checkoutToken: overrides.checkoutToken,
    body: overrides.body,
  };
}

describe('checkout HTTP routes', () => {
  it('matches only the three exact public checkout routes', () => {
    assert.deepEqual(matchCheckoutRoute('POST', '/api/self-checkout/checkouts'), {
      kind: 'create',
    });
    assert.deepEqual(matchCheckoutRoute('GET', '/api/self-checkout/checkouts/c-1'), {
      kind: 'status',
      checkoutId: 'c-1',
    });
    assert.deepEqual(matchCheckoutRoute('POST', '/api/self-checkout/checkouts/c-1/complete'), {
      kind: 'complete',
      checkoutId: 'c-1',
    });
    assert.equal(matchCheckoutRoute('GET', '/api/self-checkout/checkouts'), null);
    assert.equal(matchCheckoutRoute('POST', '/api/self-checkout/checkouts/c-1'), null);
    assert.equal(matchCheckoutRoute('GET', '/api/self-checkout/checkouts/c%2F1'), null);
    assert.equal(matchCheckoutRoute('POST', '/api//self-checkout/checkouts'), null);
    assert.equal(matchCheckoutRoute('POST', '//api/self-checkout/checkouts'), null);
    assert.equal(matchCheckoutRoute('POST', '/api/self-checkout/checkouts/'), null);
    assert.equal(matchCheckoutRoute('GET', '/api/self-checkout/checkouts//'), null);
    assert.equal(matchCheckoutRoute('GET', '/api/products'), null);
  });

  it('forwards only the checkout body and required capability headers', async () => {
    const ctx = context();
    const body = { items: [{ productId: 'p-1', quantity: 1 }] };
    assert.equal(
      (
        await handleCheckoutHttp(
          request('POST', '/api/self-checkout/checkouts', {
            body,
            idempotencyKey: 'idempotency-key',
          }),
          ctx.deps
        )
      ).status,
      201
    );
    await handleCheckoutHttp(
      request('GET', '/api/self-checkout/checkouts/c-1', { checkoutToken: 'token' }),
      ctx.deps
    );
    await handleCheckoutHttp(
      request('POST', '/api/self-checkout/checkouts/c-1/complete', {
        checkoutToken: 'token',
      }),
      ctx.deps
    );
    assert.deepEqual(ctx.calls, [
      ['create', body, 'idempotency-key'],
      ['status', 'c-1', 'token'],
      ['complete', 'c-1', 'token'],
    ]);
  });

  it('maps service failures to safe stable responses', async () => {
    const expected = [
      ['bad-request', 400],
      ['idempotency-conflict', 409],
      ['forbidden', 403],
      ['not-found', 404],
      ['out-of-stock', 409],
      ['provider-unavailable', 503],
      ['conflict', 409],
      ['manual-review', 409],
    ];
    for (const [code, status] of expected) {
      const ctx = context({
        checkout: {
          create: async () => {
            throw new CheckoutServiceError(code, code === 'provider-unavailable');
          },
        },
      });
      const response = await handleCheckoutHttp(
        request('POST', '/api/self-checkout/checkouts'),
        ctx.deps
      );
      assert.equal(response.status, status);
      assert.deepEqual(response.body, {
        error: code,
        retryable: code === 'provider-unavailable',
      });
    }
  });

  it('maps real checkout request validation to a safe bad-request response', async () => {
    const ctx = context({
      checkout: {
        create: async () => {
          throw new CheckoutServiceError('bad-request');
        },
      },
    });

    const response = await handleCheckoutHttp(
      request('POST', '/api/self-checkout/checkouts', {
        body: { items: [{ productId: 'p-1', quantity: 0 }] },
      }),
      ctx.deps
    );

    assert.deepEqual(response, {
      status: 400,
      body: { error: 'bad-request', retryable: false },
    });
  });

  it('rate limits before entering checkout orchestration', async () => {
    const ctx = context({
      rateLimiter: { consume: () => ({ allowed: false, retryAfterSeconds: 12 }) },
    });
    const response = await handleCheckoutHttp(
      request('POST', '/api/self-checkout/checkouts'),
      ctx.deps
    );
    assert.deepEqual(response, {
      status: 429,
      body: { error: 'checkout-rate-limited', retryAfterSeconds: 12 },
    });
    assert.deepEqual(ctx.calls, []);
  });

  it('does not hide unexpected infrastructure errors', async () => {
    const ctx = context({
      checkout: {
        create: async () => {
          throw new Error('store unavailable');
        },
      },
    });
    await assert.rejects(
      handleCheckoutHttp(request('POST', '/api/self-checkout/checkouts'), ctx.deps),
      /store unavailable/
    );
  });
});
