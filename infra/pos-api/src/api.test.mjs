/**
 * Unit tests for api.ts — all routes, all auth outcomes, no network.
 *
 * Runner: node --experimental-strip-types --test "src/**\/*.test.mjs"
 *
 * Design:
 *  - `MemoryStore` from the shared package provides an in-process document store
 *    so every test is hermetic and fast.
 *  - `signToken` from session-auth.ts mints valid HS256 JWTs so the auth path
 *    is exercised with real signatures, not mocks.
 *  - Time is injected via `nowSeconds` so expiry tests are deterministic.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handle, matchRoute, parseMultipartImage } from './api.ts';
import { signToken, verifySessionToken } from './session-auth.ts';
import { MemoryStore } from '../../shared/src/document-store.ts';
import { MemoryImageStore } from '../../shared/src/image-store.ts';

// ── Shared test helpers ────────────────────────────────────────────────────────

const SECRET = 'test-secret-at-least-32-characters-long';
const NOW = 1_700_000_000; // fixed epoch seconds
const FUTURE = NOW + 3600;

/**
 * Mint a staff JWT with the given permissions.
 * Staff tokens deliberately have NO `type` claim — only kiosk/shop tokens do.
 * We build this manually (not via signToken) to confirm the absence of `type`
 * is what triggers the 401 on POST /api/transactions.
 */
function staffToken(permissions = ['sale:process', 'inventory:manage'], tenantId = 'tenant-1') {
  const b64url = (value) =>
    Buffer.from(JSON.stringify(value)).toString('base64')
      .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ sub: 'op-1', tenantId, roles: ['admin'], permissions, exp: FUTURE });
  const signingInput = `${header}.${body}`;
  const sig = createHmac('sha256', SECRET).update(signingInput).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  return `${signingInput}.${sig}`;
}

/** Mint a kiosk-device token. */
function deviceToken(terminalId = 'terminal-1', tenantId = 'tenant-1') {
  return signToken({ sub: terminalId, type: 'kiosk-device', tenantId, exp: FUTURE }, SECRET);
}

/** Mint a shop-session token. */
function shopToken(storeId = 'org/store-1') {
  return signToken({ sub: storeId, type: 'shop-session', tenantId: storeId, exp: FUTURE }, SECRET);
}

/** A minimal deps object for all tests. */
function makeDeps(overrides = {}) {
  return {
    products: new MemoryStore(),
    transactions: new MemoryStore(),
    roles: new MemoryStore(),
    imageStore: new MemoryImageStore(),
    secret: SECRET,
    appId: undefined,
    internalSecret: 'int-secret',
    mpAccessToken: '',
    mpCurrencyId: 'MXN',
    appBaseUrl: 'http://localhost:4200',
    nowSeconds: () => NOW,
    nowIso: () => new Date(NOW * 1000).toISOString(),
    newId: () => 'test-uuid-' + Math.random().toString(36).slice(2),
    ...overrides,
  };
}

/** Minimal valid transaction body. */
const VALID_TX_BODY = {
  paymentMethod: 'cash',
  subtotal: 2.5,
  taxAmount: 0.2,
  total: 2.7,
  items: [
    { productId: 'p1', productName: 'Coffee', quantity: 1, unitPrice: 2.5, lineTotal: 2.5 },
  ],
};

// ── matchRoute ─────────────────────────────────────────────────────────────────

describe('matchRoute', () => {
  test('GET /api/health → health', () => {
    assert.deepEqual(matchRoute('GET', '/api/health'), { kind: 'health' });
  });
  test('POST /api/shop/session → createShopSession', () => {
    assert.deepEqual(matchRoute('POST', '/api/shop/session'), { kind: 'createShopSession' });
  });
  test('GET /api/shop/session → null', () => {
    assert.equal(matchRoute('GET', '/api/shop/session'), null);
  });
  test('POST /api/kiosk-device-token → createKioskDeviceToken', () => {
    assert.deepEqual(matchRoute('POST', '/api/kiosk-device-token'), {
      kind: 'createKioskDeviceToken',
      permission: 'inventory:manage',
    });
  });
  test('GET /api/transactions → listTransactions', () => {
    assert.deepEqual(matchRoute('GET', '/api/transactions'), {
      kind: 'listTransactions',
      permission: 'sale:view_transactions',
    });
  });
  test('POST /api/transactions → createKioskTransaction', () => {
    assert.deepEqual(matchRoute('POST', '/api/transactions'), { kind: 'createKioskTransaction' });
  });
});

// ── POST /api/shop/session ─────────────────────────────────────────────────────

describe('POST /api/shop/session', () => {
  const req = (body) => ({
    method: 'POST', path: '/api/shop/session',
    authorization: undefined, internalSecret: undefined, body,
  });

  test('valid storeId → 201 with token and expiresAt', async () => {
    const res = await handle(req({ storeId: 'org/store-1' }), makeDeps());
    assert.equal(res.status, 201);
    assert.ok(typeof res.body.token === 'string' && res.body.token.split('.').length === 3);
    assert.ok(typeof res.body.expiresAt === 'string');
  });

  test('missing storeId → 400', async () => {
    const res = await handle(req({}), makeDeps());
    assert.equal(res.status, 400);
  });

  test('null body → 400', async () => {
    const res = await handle(req(undefined), makeDeps());
    assert.equal(res.status, 400);
  });

  test('token is verifiable and has type=shop-session', async () => {
    const res = await handle(req({ storeId: 'org/store-1' }), makeDeps());
    const claims = verifySessionToken(res.body.token, SECRET, NOW);
    assert.ok(claims !== null);
    assert.equal(claims.type, 'shop-session');
    assert.equal(claims.operatorId, 'org/store-1');
  });
});

// ── POST /api/kiosk-device-token ───────────────────────────────────────────────

describe('POST /api/kiosk-device-token', () => {
  const req = (auth, body) => ({
    method: 'POST', path: '/api/kiosk-device-token',
    authorization: auth, internalSecret: undefined, body,
  });

  test('valid staff token + terminalId → 201 with token', async () => {
    const token = staffToken(['inventory:manage']);
    const res = await handle(req(`Bearer ${token}`, { terminalId: 'term-abc' }), makeDeps());
    assert.equal(res.status, 201);
    assert.ok(typeof res.body.token === 'string');
  });

  test('no auth → 401', async () => {
    const res = await handle(req(undefined, { terminalId: 'term-abc' }), makeDeps());
    assert.equal(res.status, 401);
  });

  test('missing terminalId → 400', async () => {
    const token = staffToken(['inventory:manage']);
    const res = await handle(req(`Bearer ${token}`, {}), makeDeps());
    assert.equal(res.status, 400);
  });

  test('device token has type=kiosk-device', async () => {
    const token = staffToken(['inventory:manage']);
    const res = await handle(req(`Bearer ${token}`, { terminalId: 'term-abc' }), makeDeps());
    const claims = verifySessionToken(res.body.token, SECRET, NOW);
    assert.ok(claims !== null);
    assert.equal(claims.type, 'kiosk-device');
    assert.equal(claims.operatorId, 'term-abc');
  });

  test('staff token without MANAGE_INVENTORY → 403', async () => {
    const token = staffToken(['transactions:view']); // wrong permission
    const res = await handle(req(`Bearer ${token}`, { terminalId: 'term-abc' }), makeDeps());
    assert.equal(res.status, 403);
  });
});

// ── POST /api/transactions ─────────────────────────────────────────────────────

describe('POST /api/transactions', () => {
  const req = (auth, body) => ({
    method: 'POST', path: '/api/transactions',
    authorization: auth, internalSecret: undefined, body,
  });

  test('kiosk-device token + valid body → 201 with transaction', async () => {
    const token = deviceToken();
    const res = await handle(req(`Bearer ${token}`, VALID_TX_BODY), makeDeps());
    assert.equal(res.status, 201);
    assert.equal(res.body.transaction.type, 'kiosk-sale');
    assert.equal(res.body.transaction.paymentMethod, 'cash');
  });

  test('shop-session token + valid body → 201', async () => {
    const token = shopToken();
    const res = await handle(req(`Bearer ${token}`, VALID_TX_BODY), makeDeps());
    assert.equal(res.status, 201);
  });

  test('anonymous (signed-in) customer body → 201 with customerId', async () => {
    const token = deviceToken();
    const body = { ...VALID_TX_BODY, customerId: 'cust-123', customerEmail: 'a@b.com' };
    const res = await handle(req(`Bearer ${token}`, body), makeDeps());
    assert.equal(res.status, 201);
    assert.equal(res.body.transaction.customerId, 'cust-123');
  });

  test('no token → 401', async () => {
    const res = await handle(req(undefined, VALID_TX_BODY), makeDeps());
    assert.equal(res.status, 401);
  });

  test('staff token (no type claim) → 401', async () => {
    const token = staffToken(['sale:process']);
    const res = await handle(req(`Bearer ${token}`, VALID_TX_BODY), makeDeps());
    assert.equal(res.status, 401);
  });

  test('expired kiosk-device token → 401', async () => {
    const expiredToken = signToken(
      { sub: 'terminal-1', type: 'kiosk-device', tenantId: 'tenant-1', exp: NOW - 1 },
      SECRET
    );
    const res = await handle(req(`Bearer ${expiredToken}`, VALID_TX_BODY), makeDeps());
    assert.equal(res.status, 401);
  });

  test('wrong secret → 401', async () => {
    const badToken = signToken(
      { sub: 'terminal-1', type: 'kiosk-device', tenantId: 'tenant-1', exp: FUTURE },
      'wrong-secret-at-least-32-characters-x'
    );
    const res = await handle(req(`Bearer ${badToken}`, VALID_TX_BODY), makeDeps());
    assert.equal(res.status, 401);
  });

  test('missing paymentMethod → 400', async () => {
    const token = deviceToken();
    const { paymentMethod: _, ...body } = VALID_TX_BODY;
    const res = await handle(req(`Bearer ${token}`, body), makeDeps());
    assert.equal(res.status, 400);
  });

  test('empty items array → 400', async () => {
    const token = deviceToken();
    const res = await handle(req(`Bearer ${token}`, { ...VALID_TX_BODY, items: [] }), makeDeps());
    assert.equal(res.status, 400);
  });

  test('no body → 400', async () => {
    const token = deviceToken();
    const res = await handle(req(`Bearer ${token}`, undefined), makeDeps());
    assert.equal(res.status, 400);
  });

  test('transaction is persisted to store', async () => {
    const deps = makeDeps();
    const token = deviceToken();
    await handle(req(`Bearer ${token}`, VALID_TX_BODY), deps);
    const all = await deps.transactions.list();
    assert.equal(all.length, 1);
    assert.equal(all[0].type, 'kiosk-sale');
  });
});

// ── GET /api/health ────────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  test('lists new endpoints in health response', async () => {
    const res = await handle(
      { method: 'GET', path: '/api/health', authorization: undefined, internalSecret: undefined, body: undefined },
      makeDeps()
    );
    assert.equal(res.status, 200);
    assert.ok('createShopSession' in res.body.endpoints);
    assert.ok('createKioskDeviceToken' in res.body.endpoints);
    assert.ok('createTransaction' in res.body.endpoints);
  });
});

// ── POST /api/products/:id/image ───────────────────────────────────────────────

describe('POST /api/products/:id/image', () => {
  const BOUNDARY = 'TestBoundary1234';
  const CONTENT_TYPE = `multipart/form-data; boundary=${BOUNDARY}`;

  /** Build a minimal multipart/form-data body with a single `image` part. */
  function buildMultipart(imageMime, imageBytes) {
    const enc = new TextEncoder();
    const header =
      `--${BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="image"; filename="test.jpg"\r\n` +
      `Content-Type: ${imageMime}\r\n` +
      `\r\n`;
    const footer = `\r\n--${BOUNDARY}--\r\n`;
    const headerBytes = enc.encode(header);
    const footerBytes = enc.encode(footer);
    const result = new Uint8Array(headerBytes.length + imageBytes.length + footerBytes.length);
    result.set(headerBytes, 0);
    result.set(imageBytes, headerBytes.length);
    result.set(footerBytes, headerBytes.length + imageBytes.length);
    return result;
  }

  /** A tiny 4-byte "fake JPEG" payload — real signature bytes aren't checked server-side. */
  const FAKE_JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);

  function makeProduct(id = 'prod-img-1') {
    return {
      id,
      name: 'Test Product',
      price: 1.5,
      category: 'test',
      stock: 10,
      description: '',
      createdAt: new Date(NOW * 1000).toISOString(),
      updatedAt: new Date(NOW * 1000).toISOString(),
    };
  }

  async function seedProduct(deps, product = makeProduct()) {
    await deps.products.create(product);
    return product;
  }

  function req(productId, rawBody, contentType, auth) {
    return {
      method: 'POST',
      path: `/api/products/${productId}/image`,
      authorization: auth,
      internalSecret: undefined,
      body: undefined,
      rawBody,
      contentType,
    };
  }

  test('happy path — authenticated upload with valid JPEG multipart → 200 + imageUrl', async () => {
    const deps = makeDeps({ imageStore: new MemoryImageStore() });
    const product = await seedProduct(deps);
    const token = staffToken(['inventory:manage']);
    const body = buildMultipart('image/jpeg', FAKE_JPEG);

    const res = await handle(req(product.id, body, CONTENT_TYPE, `Bearer ${token}`), deps);

    assert.equal(res.status, 200);
    assert.ok(typeof res.body.imageUrl === 'string' && res.body.imageUrl.length > 0,
      `imageUrl should be a non-empty string, got: ${JSON.stringify(res.body.imageUrl)}`);
    assert.ok(res.body.imageUrl.startsWith('data:image/jpeg;base64,'),
      `imageUrl should start with data:image/jpeg;base64,`);

    // imageUrl should be written back to the product document
    const updated = await deps.products.read(product.id);
    assert.equal(updated.document.imageUrl, res.body.imageUrl);
  });

  test('401 for unauthenticated call', async () => {
    const deps = makeDeps({ imageStore: new MemoryImageStore() });
    await seedProduct(deps);
    const body = buildMultipart('image/jpeg', FAKE_JPEG);

    const res = await handle(req('prod-img-1', body, CONTENT_TYPE, undefined), deps);
    assert.equal(res.status, 401);
  });

  test('404 for unknown product id', async () => {
    const deps = makeDeps({ imageStore: new MemoryImageStore() });
    const token = staffToken(['inventory:manage']);
    const body = buildMultipart('image/jpeg', FAKE_JPEG);

    const res = await handle(req('does-not-exist', body, CONTENT_TYPE, `Bearer ${token}`), deps);
    assert.equal(res.status, 404);
  });

  test('413 for body exceeding 2 MiB', async () => {
    const deps = makeDeps({ imageStore: new MemoryImageStore() });
    await seedProduct(deps);
    const token = staffToken(['inventory:manage']);
    // Build a payload that is 2 MiB + 1 byte — the handler checks rawBody.length
    const oversized = new Uint8Array(2_097_153);
    const body = buildMultipart('image/jpeg', oversized);

    const res = await handle(req('prod-img-1', body, CONTENT_TYPE, `Bearer ${token}`), deps);
    assert.equal(res.status, 413);
  });

  test('415 for non-image content type in multipart part', async () => {
    const deps = makeDeps({ imageStore: new MemoryImageStore() });
    await seedProduct(deps);
    const token = staffToken(['inventory:manage']);
    const body = buildMultipart('text/plain', new Uint8Array([0x68, 0x65, 0x6c, 0x6c, 0x6f]));

    const res = await handle(req('prod-img-1', body, CONTENT_TYPE, `Bearer ${token}`), deps);
    assert.equal(res.status, 415);
  });
});

// ── POST /api/mercadopago/preference ──────────────────────────────────────────

/** Minimal valid card-token payload from the MP Brick. */
const VALID_MP_BODY = {
  formData: {
    token: 'card-token-abc123',
    issuer_id: '24',
    payment_method_id: 'visa',
    transaction_amount: 99.99,
    installments: 1,
    payer: {
      email: 'buyer@example.com',
      identification: { type: 'DNI', number: '12345678' },
    },
  },
  amount: 99.99,
};

/** Build a fake fetch that returns the given status and JSON body. */
function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  });
}

describe('POST /api/mercadopago/preference', () => {
  test('503 when mpAccessToken is empty', async () => {
    const deps = makeDeps({ mpAccessToken: '' });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: VALID_MP_BODY },
      deps
    );
    assert.equal(res.status, 503);
  });

  test('400 when body is missing', async () => {
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(200, {}) });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: undefined },
      deps
    );
    assert.equal(res.status, 400);
  });

  test('400 when formData is absent', async () => {
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(200, {}) });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: { amount: 10 } },
      deps
    );
    assert.equal(res.status, 400);
  });

  test('400 when token field is missing from formData', async () => {
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(200, {}) });
    const badBody = { ...VALID_MP_BODY, formData: { ...VALID_MP_BODY.formData, token: '' } };
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: badBody },
      deps
    );
    assert.equal(res.status, 400);
  });

  test('200 + { id, status } on approved payment', async () => {
    const mpResult = { id: 123456, status: 'approved' };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(200, mpResult) });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: VALID_MP_BODY },
      deps
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.id, '123456');
    assert.equal(res.body.status, 'approved');
  });

  test('200 + pending status forwarded as-is', async () => {
    const mpResult = { id: 999, status: 'pending' };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(200, mpResult) });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: VALID_MP_BODY },
      deps
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'pending');
  });

  test('502 when MP upstream returns non-2xx', async () => {
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(422, { message: 'invalid token' }) });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: VALID_MP_BODY },
      deps
    );
    assert.equal(res.status, 502);
  });

  test('502 when fetch throws (network error)', async () => {
    const throwingFetch = async () => { throw new Error('ECONNREFUSED'); };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: throwingFetch });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: VALID_MP_BODY },
      deps
    );
    assert.equal(res.status, 502);
  });

  test('GET /api/mercadopago/preference → 404', async () => {
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN' });
    const res = await handle(
      { method: 'GET', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: undefined },
      deps
    );
    assert.equal(res.status, 404);
  });

  // ── Wallet mode ──────────────────────────────────────────────────────────────

  test('wallet mode: 200 + { id, initPoint } on successful preference creation', async () => {
    const prefResult = { id: 'pref-123', init_point: 'https://mp.com/checkout/pref-123' };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(200, prefResult) });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: { mode: 'wallet', amount: 49.99 } },
      deps
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.id, 'pref-123');
    assert.equal(res.body.initPoint, 'https://mp.com/checkout/pref-123');
  });

  test('wallet mode: 400 when amount is missing', async () => {
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(200, {}) });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: { mode: 'wallet' } },
      deps
    );
    assert.equal(res.status, 400);
  });

  test('wallet mode: 502 when MP preferences endpoint returns non-2xx', async () => {
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(400, { message: 'bad request' }) });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: { mode: 'wallet', amount: 10 } },
      deps
    );
    assert.equal(res.status, 502);
  });

  test('wallet mode: 502 when fetch throws', async () => {
    const throwingFetch = async () => { throw new Error('ECONNREFUSED'); };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: throwingFetch });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: { mode: 'wallet', amount: 10 } },
      deps
    );
    assert.equal(res.status, 502);
  });

  test('wallet mode: custom title is forwarded to MP preference', async () => {
    let capturedBody = null;
    const capturingFetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 'p1', init_point: 'https://mp.com/p1' }), text: async () => '' };
    };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: capturingFetch });
    await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: { mode: 'wallet', amount: 25, title: 'Table 5 order' } },
      deps
    );
    assert.ok(capturedBody.items[0].title === 'Table 5 order', 'title should be forwarded');
  });

  test('wallet mode: mpCurrencyId is forwarded to MP preference items', async () => {
    let capturedBody = null;
    const capturingFetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 'p2', init_point: 'https://mp.com/p2' }), text: async () => '' };
    };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', mpCurrencyId: 'MXN', fetch: capturingFetch });
    await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: { mode: 'wallet', amount: 99 } },
      deps
    );
    assert.equal(capturedBody.items[0].currency_id, 'MXN', 'currency_id should match mpCurrencyId');
  });

  test('wallet mode: default ARS currency is used when mpCurrencyId is ARS', async () => {
    let capturedBody = null;
    const capturingFetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 'p3', init_point: 'https://mp.com/p3' }), text: async () => '' };
    };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', mpCurrencyId: 'ARS', fetch: capturingFetch });
    await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: { mode: 'wallet', amount: 50 } },
      deps
    );
    assert.equal(capturedBody.items[0].currency_id, 'ARS', 'currency_id should be ARS');
  });

  test('wallet mode: back_urls use appBaseUrl', async () => {
    let capturedBody = null;
    const capturingFetch = async (url, opts) => {
      capturedBody = JSON.parse(opts.body);
      return { ok: true, json: async () => ({ id: 'p4', init_point: 'https://mp.com/p4' }), text: async () => '' };
    };
    const deps = makeDeps({
      mpAccessToken: 'TEST_TOKEN',
      appBaseUrl: 'https://my-pos.example.com',
      fetch: capturingFetch,
    });
    await handle(
      { method: 'POST', path: '/api/mercadopago/preference', authorization: undefined,
        internalSecret: undefined, body: { mode: 'wallet', amount: 10 } },
      deps
    );
    assert.equal(capturedBody.back_urls.success, 'https://my-pos.example.com/payment/success');
    assert.equal(capturedBody.back_urls.failure, 'https://my-pos.example.com/payment/failure');
    assert.equal(capturedBody.back_urls.pending, 'https://my-pos.example.com/payment/pending');
  });
});

// ── GET /api/mercadopago/preference/:id ──────────────────────────────────────

describe('GET /api/mercadopago/preference/:id', () => {
  const req = (id) => ({
    method: 'GET',
    path: `/api/mercadopago/preference/${encodeURIComponent(id)}`,
    authorization: undefined,
    internalSecret: undefined,
    body: undefined,
  });

  test('503 when mpAccessToken is empty', async () => {
    const deps = makeDeps({ mpAccessToken: '' });
    const res = await handle(req('pref-123'), deps);
    assert.equal(res.status, 503);
  });

  test('200 + approved status when MP returns an approved payment', async () => {
    const mpResult = { results: [{ status: 'approved' }], paging: { total: 1 } };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(200, mpResult) });
    const res = await handle(req('pref-123'), deps);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'approved');
  });

  test('200 + not_found when MP returns empty results', async () => {
    const mpResult = { results: [], paging: { total: 0 } };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(200, mpResult) });
    const res = await handle(req('pref-123'), deps);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'not_found');
  });

  test('200 + pending status forwarded', async () => {
    const mpResult = { results: [{ status: 'pending' }] };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(200, mpResult) });
    const res = await handle(req('pref-123'), deps);
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'pending');
  });

  test('502 when MP payments search returns non-2xx', async () => {
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: fakeFetch(403, { message: 'forbidden' }) });
    const res = await handle(req('pref-123'), deps);
    assert.equal(res.status, 502);
  });

  test('502 when fetch throws (network error)', async () => {
    const throwingFetch = async () => { throw new Error('ECONNREFUSED'); };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: throwingFetch });
    const res = await handle(req('pref-123'), deps);
    assert.equal(res.status, 502);
  });

  test('POST /api/mercadopago/preference/:id → 404 (only GET allowed on this path)', async () => {
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN' });
    const res = await handle(
      { method: 'POST', path: '/api/mercadopago/preference/pref-123',
        authorization: undefined, internalSecret: undefined, body: {} },
      deps
    );
    assert.equal(res.status, 404);
  });

  test('preference id is URL-decoded from the path segment', async () => {
    let capturedUrl = null;
    const capturingFetch = async (url) => {
      capturedUrl = url;
      return { ok: true, json: async () => ({ results: [{ status: 'approved' }] }), text: async () => '' };
    };
    const deps = makeDeps({ mpAccessToken: 'TEST_TOKEN', fetch: capturingFetch });
    await handle(req('pref-abc/xyz'), deps);
    // The preference id should be in the MP search URL
    assert.ok(capturedUrl.includes('pref-abc'), 'preference id should be in the search URL');
  });
});
