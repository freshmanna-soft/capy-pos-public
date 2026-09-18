import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const { clientRateLimitKey, createPosRequestHandler, readAllowedOrigins } =
  await import('./server.ts');
const { CheckoutServiceError } = await import('./checkout-service.ts');

class AllowAllRateLimiter {
  consume() {
    return { allowed: true };
  }
}

function deps() {
  return {
    api: {
      products: { list: async () => [] },
      transactions: { list: async () => [] },
      roles: { read: async () => null },
      secret: 'unused-test-secret',
      internalSecret: '',
      nowSeconds: () => 0,
      nowIso: () => '2026-09-18T12:00:00.000Z',
      newId: () => 'id-1',
    },
    checkout: {
      checkouts: {},
      rateLimiter: new AllowAllRateLimiter(),
      service: {
        async create(body, idempotencyKey) {
          return { checkoutId: 'checkout-1', checkoutToken: idempotencyKey, body };
        },
        async status(checkoutId, checkoutToken) {
          return { checkoutId, checkoutToken, state: 'awaiting-approval' };
        },
        async complete(checkoutId, checkoutToken) {
          return { checkoutId, checkoutToken, state: 'completed' };
        },
      },
    },
  };
}

const servers = [];
afterEach(async () => {
  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
  await Promise.all(
    servers
      .splice(0)
      .map(
        (server) =>
          new Promise((resolve, reject) =>
            server.close((error) => (error ? reject(error) : resolve()))
          )
      )
  );
});

async function withServer(run) {
  const server = createServer(
    createPosRequestHandler({
      ...deps(),
      allowedOrigins: new Set(['https://capy-pos.com']),
      newTraceId: () => 'trace-1',
    })
  );
  servers.push(server);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return run(`http://127.0.0.1:${address.port}`);
}

describe('POS API HTTP adapter', () => {
  it('keys rate limits from the trusted right-hand forwarded hop', () => {
    const request = (forwarded, remoteAddress = '10.0.0.1') => ({
      headers: forwarded === undefined ? {} : { 'x-forwarded-for': forwarded },
      socket: { remoteAddress },
    });
    assert.equal(clientRateLimitKey(request('attacker-picked-1, 198.51.100.7')), '198.51.100.7');
    assert.equal(clientRateLimitKey(request('attacker-picked-2, 198.51.100.7')), '198.51.100.7');
    assert.equal(clientRateLimitKey(request(undefined, '127.0.0.1')), '127.0.0.1');
    assert.equal(clientRateLimitKey(request('spoofed, 198.51.100.7, 10.1.1.1'), 2), '198.51.100.7');
  });

  it('parses only exact configured origins', () => {
    assert.deepEqual(
      [...readAllowedOrigins({ ALLOWED_ORIGINS: 'https://capy-pos.com,http://localhost:4200' })],
      ['https://capy-pos.com', 'http://localhost:4200']
    );
    assert.throws(() => readAllowedOrigins({}), /at least one origin/);
    assert.throws(
      () => readAllowedOrigins({ ALLOWED_ORIGINS: 'https://capy-pos.com/path' }),
      /invalid origin/
    );
    assert.throws(
      () => readAllowedOrigins({ ALLOWED_ORIGINS: 'http://capy-pos.com' }),
      /invalid origin/
    );
  });

  it('serves checkout routes with exact-origin CORS and private response policy', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/self-checkout/checkouts`, {
        method: 'POST',
        headers: {
          Origin: 'https://capy-pos.com',
          'Content-Type': 'application/json',
          'Idempotency-Key': 'idempotency-key',
        },
        body: JSON.stringify({ items: [{ productId: 'p-1', quantity: 1 }] }),
      });
      assert.equal(response.status, 201);
      assert.equal(response.headers.get('access-control-allow-origin'), 'https://capy-pos.com');
      assert.equal(response.headers.get('vary'), 'Origin');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.equal(response.headers.get('x-trace-id'), 'trace-1');
      assert.equal((await response.json()).checkoutToken, 'idempotency-key');
    });
  });

  it('rejects foreign origins before reading or routing the body', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/self-checkout/checkouts`, {
        method: 'POST',
        headers: { Origin: 'https://evil.example', 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: [] }),
      });
      assert.equal(response.status, 403);
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.equal(response.headers.get('vary'), 'Origin');
      assert.deepEqual(await response.json(), { error: 'Origin not allowed.' });
    });
  });

  it('advertises checkout headers on approved preflight responses', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/self-checkout/checkouts`, {
        method: 'OPTIONS',
        headers: { Origin: 'https://capy-pos.com' },
      });
      assert.equal(response.status, 204);
      assert.match(response.headers.get('access-control-allow-headers'), /Idempotency-Key/);
      assert.match(response.headers.get('access-control-allow-headers'), /X-Checkout-Token/);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });
  });

  it('returns safe provider failures with no provider or secret details', async () => {
    const server = createServer(
      createPosRequestHandler({
        ...deps(),
        checkout: {
          checkouts: {},
          rateLimiter: new AllowAllRateLimiter(),
          service: {
            async create() {
              throw new CheckoutServiceError('provider-unavailable', true);
            },
          },
        },
        allowedOrigins: new Set(['https://capy-pos.com']),
        newTraceId: () => 'trace-provider',
      })
    );
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/self-checkout/checkouts`, {
      method: 'POST',
      headers: {
        Origin: 'https://capy-pos.com',
        'Content-Type': 'application/json',
        'Idempotency-Key': 'secret-idempotency-key',
        'X-Checkout-Token': 'secret-checkout-token',
      },
      body: JSON.stringify({ items: [{ productId: 'p-1', quantity: 1 }] }),
    });
    const raw = await response.text();
    assert.equal(response.status, 503);
    assert.deepEqual(JSON.parse(raw), { error: 'provider-unavailable', retryable: true });
    assert.doesNotMatch(raw, /secret-|PayPal|provider payload/i);
  });

  it('exposes Retry-After on checkout rate-limit responses', async () => {
    const limited = deps();
    limited.checkout.rateLimiter = { consume: () => ({ allowed: false, retryAfterSeconds: 12 }) };
    const server = createServer(
      createPosRequestHandler({
        ...limited,
        allowedOrigins: new Set(['https://capy-pos.com']),
        newTraceId: () => 'trace-rate-limit',
      })
    );
    servers.push(server);
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/self-checkout/checkouts`, {
      method: 'POST',
      headers: { Origin: 'https://capy-pos.com' },
    });
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '12');
  });

  it('enforces the smaller checkout body limit', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/self-checkout/checkouts`, {
        method: 'POST',
        headers: { Origin: 'https://capy-pos.com', 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: 'x'.repeat(17 * 1024) }),
      });
      assert.equal(response.status, 413);
      assert.equal(response.headers.get('cache-control'), 'no-store');
    });
  });
});
