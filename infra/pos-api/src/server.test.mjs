import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const IMAGE_SECRET = 'test-secret-at-least-32-characters-long';
const IMAGE_FUTURE = Math.floor(Date.now() / 1000) + 3600;

function imageStaffToken() {
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = encode({ alg: 'HS256', typ: 'JWT' });
  const payload = encode({
    sub: 'operator-1',
    tenantId: 'tenant-1',
    roles: ['inventory-manager'],
    permissions: ['inventory:manage'],
    exp: IMAGE_FUTURE,
  });
  const signature = createHmac('sha256', IMAGE_SECRET)
    .update(`${header}.${payload}`)
    .digest('base64url');
  return `${header}.${payload}.${signature}`;
}

function multipartImageBody(boundary = 'MixedCaseBoundary', bytes = new Uint8Array([0xff, 0xd8])) {
  const enc = new TextEncoder();
  const header =
    `--${boundary}\r\n` +
    'Content-Disposition: form-data; name="image"; filename="test.jpg"\r\n' +
    'Content-Type: image/jpeg\r\n\r\n';
  const footer = `\r\n--${boundary}--\r\n`;
  const headerBytes = enc.encode(header);
  const footerBytes = enc.encode(footer);
  const body = new Uint8Array(headerBytes.length + bytes.length + footerBytes.length);
  body.set(headerBytes);
  body.set(bytes, headerBytes.length);
  body.set(footerBytes, headerBytes.length + bytes.length);
  return body;
}
const {
  clientRateLimitKey,
  createPosRequestHandler,
  readAllowedOrigins,
  readAppIdConfig,
  readCustomerAppIdConfig,
} = await import('./server.ts');
const { CheckoutServiceError } = await import('./checkout-service.ts');

class AllowAllRateLimiter {
  consume() {
    return { allowed: true };
  }
}

function deps() {
  return {
    api: {
      products: {
        list: async () => [],
        read: async (id) => ({
          rev: '1-test-rev',
          document: { id, name: 'Test image product', price: 1, category: 'test', stock: 1 },
        }),
        write: async () => undefined,
      },
      transactions: { list: async () => [] },
      roles: { read: async () => null },
      imageStore: {
        upload: async (id, mimeType, data) => `memory:${id}:${mimeType}:${data.length}`,
      },
      secret: IMAGE_SECRET,
      internalSecret: '',
      nowSeconds: () => 0,
      nowIso: () => '2026-09-18T12:00:00.000Z',
      newId: () => 'id-1',
    },
    customerLoyalty: { read: async () => null },
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
  it('keeps staff and customer App ID audiences in separate configs', () => {
    const environment = {
      APPID_REGION: 'us-south',
      APPID_TENANT_ID: 'tenant-1',
      APPID_CLIENT_ID: 'staff-client',
      APPID_CUSTOMER_CLIENT_ID: 'customer-client',
    };
    assert.deepEqual(readAppIdConfig(environment), {
      region: 'us-south',
      tenantId: 'tenant-1',
      audience: 'staff-client',
    });
    assert.deepEqual(readCustomerAppIdConfig(environment), {
      region: 'us-south',
      tenantId: 'tenant-1',
      audience: 'customer-client',
    });
    assert.equal(readCustomerAppIdConfig({ APPID_REGION: 'us-south' }), undefined);
    assert.throws(
      () => readCustomerAppIdConfig({ APPID_CUSTOMER_CLIENT_ID: 'customer-client' }),
      /APPID_REGION and APPID_TENANT_ID/
    );
  });

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

  it('rate-limits shop-session minting per forwarded client, not one shared bucket', async () => {
    await withServer(async (url) => {
      const mint = (clientAddress) =>
        fetch(`${url}/api/shop/session`, {
          method: 'POST',
          headers: {
            Origin: 'https://capy-pos.com',
            'Content-Type': 'application/json',
            'X-Forwarded-For': clientAddress,
          },
          body: JSON.stringify({ storeId: 'org/store-1' }),
        });
      for (let i = 0; i < 20; i += 1) {
        assert.equal((await mint('198.51.100.20')).status, 201);
      }
      assert.equal((await mint('198.51.100.20')).status, 429);
      // A second shopper is unaffected by the first one's spent bucket.
      assert.equal((await mint('198.51.100.21')).status, 201);
    });
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

  it('serves loyalty routes with the private response policy before staff authorization', async () => {
    await withServer(async (url) => {
      const response = await fetch(`${url}/api/self-checkout/customer/loyalty`, {
        headers: { Origin: 'https://capy-pos.com' },
      });
      assert.equal(response.status, 401);
      assert.equal(response.headers.get('access-control-allow-origin'), 'https://capy-pos.com');
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('referrer-policy'), 'no-referrer');
      assert.deepEqual(await response.json(), { error: 'Customer authorization required.' });
    });
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

  it('preserves multipart boundary casing while detecting image uploads', async () => {
    await withServer(async (url) => {
      const boundary = 'MixedCaseBoundary';
      const response = await fetch(`${url}/api/products/product-1/image`, {
        method: 'POST',
        headers: {
          Origin: 'https://capy-pos.com',
          Authorization: `Bearer ${imageStaffToken()}`,
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body: multipartImageBody(boundary),
      });
      const payload = await response.json();
      assert.equal(response.status, 200, JSON.stringify(payload));
      assert.deepEqual(payload, {
        imageUrl: 'memory:product-1:image/jpeg:2',
      });
    });
  });
});
