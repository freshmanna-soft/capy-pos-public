import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CheckoutServiceError } from './checkout-service.ts';
import { handleCheckoutHttp, matchCheckoutRoute } from './checkout-http.ts';

function context(overrides = {}) {
  const calls = [];
  const checkout = {
    async create(body, idempotencyKey, customer) {
      calls.push(['create', body, idempotencyKey, customer]);
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
    authorization: overrides.authorization,
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
      ['create', body, 'idempotency-key', null],
      ['status', 'c-1', 'token'],
      ['complete', 'c-1', 'token'],
    ]);
  });

  it('passes a verified customer only to checkout creation', async () => {
    const keyPair = (await import('node:crypto')).generateKeyPairSync('rsa', {
      modulusLength: 2048,
    });
    const config = {
      region: 'us-south',
      tenantId: 'checkout-customer-tenant',
      audience: 'customer-client',
    };
    const issuer = `https://${config.region}.appid.cloud.ibm.com/oauth/v4/${config.tenantId}`;
    const kid = 'checkout-http-customer-key';
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const payload = {
      sub: 'customer-1',
      scope: 'openid customer',
      iss: issuer,
      aud: [config.audience],
      exp: 1_800_000_100,
    };
    const signingInput = `${encode({ alg: 'RS256', kid })}.${encode(payload)}`;
    const signature = (await import('node:crypto'))
      .sign('RSA-SHA256', Buffer.from(signingInput), keyPair.privateKey)
      .toString('base64url');
    const token = `${signingInput}.${signature}`;
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        keys: [{ kid, ...keyPair.publicKey.export({ format: 'jwk' }) }],
      }),
    });
    try {
      const ctx = context();
      ctx.deps.customerAuth = config;
      ctx.deps.nowSeconds = () => 1_800_000_000;
      const response = await handleCheckoutHttp(
        request('POST', '/api/self-checkout/checkouts', {
          authorization: `Bearer ${token}`,
          body: { items: [] },
          idempotencyKey: 'key',
        }),
        ctx.deps
      );
      assert.equal(response.status, 201);
      assert.equal(ctx.calls[0][0], 'create');
      assert.equal(ctx.calls[0][3].subject, 'customer-1');
    } finally {
      globalThis.fetch = original;
    }
  });

  it('rejects invalid present auth without degrading to guest', async () => {
    for (const authorization of ['Bearer forged', ['Bearer first', 'Bearer second']]) {
      const ctx = context();
      ctx.deps.customerAuth = { region: 'us-south', tenantId: 'tenant', audience: 'customer' };
      const response = await handleCheckoutHttp(
        request('POST', '/api/self-checkout/checkouts', { authorization }),
        ctx.deps
      );
      assert.deepEqual(response, {
        status: 401,
        body: { error: 'Customer authorization required.' },
      });
      assert.deepEqual(ctx.calls, []);
    }
  });

  it('does not authenticate status or completion with the customer bearer', async () => {
    const ctx = context();
    await handleCheckoutHttp(
      request('GET', '/api/self-checkout/checkouts/c-1', {
        authorization: 'Bearer forged',
        checkoutToken: 'capability',
      }),
      ctx.deps
    );
    await handleCheckoutHttp(
      request('POST', '/api/self-checkout/checkouts/c-1/complete', {
        authorization: 'Bearer forged',
        checkoutToken: 'capability',
      }),
      ctx.deps
    );
    assert.deepEqual(ctx.calls, [
      ['status', 'c-1', 'capability'],
      ['complete', 'c-1', 'capability'],
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
