/**
 * Mercado Pago Point routes — auth boundary, validation, idempotency, upstream mapping.
 * Runner: node --experimental-strip-types --test "src/**\/*.test.mjs"
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handle, matchRoute } from './api.ts';
import { formatAmount } from './mp-point.ts';
import { MemoryStore } from '../../shared/src/document-store.ts';
import { MemoryImageStore } from '../../shared/src/image-store.ts';

const SECRET = 'test-secret-at-least-32-characters-long';
const NOW = 1_700_000_000;
const TERMINAL = 'NEWLAND_N950__N950NCB801293324';

function staffToken(permissions = ['sale:process']) {
  const b64url = (value) =>
    Buffer.from(JSON.stringify(value))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({
    sub: 'op-1',
    tenantId: 'tenant-1',
    roles: ['operator'],
    permissions,
    exp: NOW + 3600,
  });
  const signingInput = `${header}.${body}`;
  const sig = createHmac('sha256', SECRET)
    .update(signingInput)
    .digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  return `${signingInput}.${sig}`;
}

function makeDeps(overrides = {}) {
  return {
    products: new MemoryStore(),
    transactions: new MemoryStore(),
    roles: new MemoryStore(),
    imageStore: new MemoryImageStore(),
    secret: SECRET,
    appId: undefined,
    internalSecret: 'int-secret',
    mpAccessToken: 'TEST_TOKEN',
    mpCurrencyId: 'MXN',
    mpPointTerminalIds: [TERMINAL],
    appBaseUrl: 'http://localhost:4200',
    nowSeconds: () => NOW,
    nowIso: () => new Date(NOW * 1000).toISOString(),
    newId: () => 'test-uuid',
    ...overrides,
  };
}

/** A fetch that records each call and answers with the given status and body. */
function recordingFetch(status, body) {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  };
  return { fetch, calls };
}

const NO_TOKEN = Symbol('no token');

/** Staff-authenticated by default; pass `NO_TOKEN` for an anonymous request. */
const req = (method, path, body, authorization = `Bearer ${staffToken()}`) => ({
  method,
  path,
  authorization: authorization === NO_TOKEN ? undefined : authorization,
  internalSecret: undefined,
  body,
});

const VALID_CREATE = { amount: 24, externalReference: 'TXN-ABC-123', terminalId: TERMINAL };

describe('formatAmount', () => {
  test('uses integer cents, never float artefacts', () => {
    assert.equal(formatAmount(24), '24.00');
    assert.equal(formatAmount(0.1 + 0.2), '0.30');
    assert.equal(formatAmount(19.99), '19.99');
    assert.equal(formatAmount(1.1), '1.10');
    assert.equal(formatAmount(0.05), '0.05');
  });
});

describe('matchRoute — point', () => {
  test('create / get / cancel need sale:process', () => {
    assert.deepEqual(matchRoute('POST', '/api/mercadopago/point/orders'), {
      kind: 'createPointOrder',
      permission: 'sale:process',
    });
    assert.deepEqual(matchRoute('GET', '/api/mercadopago/point/orders/ORD1'), {
      kind: 'getPointOrder',
      permission: 'sale:process',
      orderId: 'ORD1',
    });
    assert.deepEqual(matchRoute('POST', '/api/mercadopago/point/orders/ORD1/cancel'), {
      kind: 'cancelPointOrder',
      permission: 'sale:process',
      orderId: 'ORD1',
    });
  });

  test('wrong verbs and extra segments → null', () => {
    assert.equal(matchRoute('GET', '/api/mercadopago/point/orders'), null);
    assert.equal(matchRoute('POST', '/api/mercadopago/point/orders/ORD1'), null);
    assert.equal(matchRoute('GET', '/api/mercadopago/point/orders/ORD1/cancel'), null);
    assert.equal(matchRoute('POST', '/api/mercadopago/point/orders/ORD1/refund'), null);
    assert.equal(matchRoute('POST', '/api/mercadopago/point/orders/ORD1/cancel/x'), null);
  });
});

describe('Point routes — auth boundary', () => {
  test('no token → 401 on every route, and Mercado Pago is never called', async () => {
    const mp = recordingFetch(200, {});
    const deps = makeDeps({ fetch: mp.fetch });
    for (const [method, path] of [
      ['POST', '/api/mercadopago/point/orders'],
      ['GET', '/api/mercadopago/point/orders/ORD1'],
      ['POST', '/api/mercadopago/point/orders/ORD1/cancel'],
    ]) {
      const res = await handle(req(method, path, VALID_CREATE, NO_TOKEN), deps);
      assert.equal(res.status, 401, `${method} ${path}`);
    }
    assert.equal(mp.calls.length, 0);
  });

  test('a token without sale:process → 403', async () => {
    const mp = recordingFetch(200, {});
    const res = await handle(
      req('POST', '/api/mercadopago/point/orders', VALID_CREATE, `Bearer ${staffToken([])}`),
      makeDeps({ fetch: mp.fetch })
    );
    assert.equal(res.status, 403);
    assert.equal(mp.calls.length, 0);
  });
});

describe('POST /api/mercadopago/point/orders', () => {
  test('503 when the access token or the allow-list is empty', async () => {
    for (const overrides of [{ mpAccessToken: '' }, { mpPointTerminalIds: [] }]) {
      const res = await handle(
        req('POST', '/api/mercadopago/point/orders', VALID_CREATE),
        makeDeps(overrides)
      );
      assert.equal(res.status, 503);
    }
  });

  test('400 on a non-object body, bad amount, bad reference', async () => {
    const mp = recordingFetch(200, {});
    const deps = makeDeps({ fetch: mp.fetch });
    const post = (body) => handle(req('POST', '/api/mercadopago/point/orders', body), deps);

    assert.equal((await post(undefined)).status, 400);
    assert.equal((await post({ ...VALID_CREATE, amount: 0 })).status, 400);
    assert.equal((await post({ ...VALID_CREATE, amount: -5 })).status, 400);
    assert.equal((await post({ ...VALID_CREATE, amount: '24' })).status, 400);
    assert.equal((await post({ ...VALID_CREATE, amount: 2_000_000 })).status, 400);
    assert.equal((await post({ ...VALID_CREATE, externalReference: '' })).status, 400);
    assert.equal((await post({ ...VALID_CREATE, externalReference: '../x' })).status, 400);
    assert.equal(mp.calls.length, 0);
  });

  test('an amount below the Point minimum is refused with a clear 400, without calling Mercado Pago', async () => {
    const mp = recordingFetch(200, {});
    const deps = makeDeps({ fetch: mp.fetch });
    const post = (body) => handle(req('POST', '/api/mercadopago/point/orders', body), deps);

    const below = await post({ ...VALID_CREATE, amount: 4.99 });
    assert.equal(below.status, 400);
    assert.match(below.body.error, /minimum/i);
    assert.equal(mp.calls.length, 0);

    const exactly = await post({ ...VALID_CREATE, amount: 5 });
    assert.equal(exactly.status, 201);
    assert.equal(mp.calls.length, 1);
  });

  test('a terminal outside the allow-list is refused without calling Mercado Pago', async () => {
    const mp = recordingFetch(200, {});
    const res = await handle(
      req('POST', '/api/mercadopago/point/orders', { ...VALID_CREATE, terminalId: 'EVIL__1' }),
      makeDeps({ fetch: mp.fetch })
    );
    assert.equal(res.status, 400);
    assert.equal(mp.calls.length, 0);
  });

  test('sends a point order with string amount, reference, terminal and a derived idempotency key', async () => {
    const mp = recordingFetch(200, {
      id: 'ORD123',
      status: 'created',
      status_detail: 'created',
      external_reference: 'TXN-ABC-123',
      transactions: { payments: [{ id: 'PAY1', amount: '24.00' }] },
    });
    const res = await handle(
      req('POST', '/api/mercadopago/point/orders', VALID_CREATE),
      makeDeps({ fetch: mp.fetch })
    );

    assert.equal(res.status, 201);
    assert.deepEqual(res.body, {
      id: 'ORD123',
      status: 'created',
      statusDetail: 'created',
      externalReference: 'TXN-ABC-123',
      paymentId: 'PAY1',
    });

    const [call] = mp.calls;
    assert.equal(call.url, 'https://api.mercadopago.com/v1/orders');
    assert.equal(call.init.method, 'POST');
    assert.equal(call.init.headers.Authorization, 'Bearer TEST_TOKEN');
    assert.equal(call.init.headers['X-Idempotency-Key'], 'point-create-TXN-ABC-123');
    assert.equal(call.body.type, 'point');
    assert.equal(call.body.external_reference, 'TXN-ABC-123');
    assert.equal(call.body.transactions.payments[0].amount, '24.00');
    assert.equal(call.body.config.point.terminal_id, TERMINAL);
    assert.match(call.body.expiration_time, /^PT/);
  });

  test('the same sale always produces the same idempotency key (no double charge on retry)', async () => {
    const mp = recordingFetch(200, { id: 'ORD1', status: 'created' });
    const deps = makeDeps({ fetch: mp.fetch });
    await handle(req('POST', '/api/mercadopago/point/orders', VALID_CREATE), deps);
    await handle(req('POST', '/api/mercadopago/point/orders', VALID_CREATE), deps);
    assert.equal(
      mp.calls[0].init.headers['X-Idempotency-Key'],
      mp.calls[1].init.headers['X-Idempotency-Key']
    );
  });

  test('upstream failure → generic 502, no upstream detail leaks', async () => {
    const mp = recordingFetch(500, { message: 'secret internal detail' });
    const res = await handle(
      req('POST', '/api/mercadopago/point/orders', VALID_CREATE),
      makeDeps({ fetch: mp.fetch })
    );
    assert.equal(res.status, 502);
    assert.ok(!JSON.stringify(res.body).includes('secret internal detail'));
  });

  test('upstream 409 → 409 "busy"', async () => {
    const mp = recordingFetch(409, {});
    const res = await handle(
      req('POST', '/api/mercadopago/point/orders', VALID_CREATE),
      makeDeps({ fetch: mp.fetch })
    );
    assert.equal(res.status, 409);
  });

  test('network failure → 502', async () => {
    const res = await handle(
      req('POST', '/api/mercadopago/point/orders', VALID_CREATE),
      makeDeps({
        fetch: async () => {
          throw new Error('ECONNRESET');
        },
      })
    );
    assert.equal(res.status, 502);
  });
});

describe('GET /api/mercadopago/point/orders/:id', () => {
  test('returns the summarized status', async () => {
    const mp = recordingFetch(200, {
      id: 'ORD1',
      status: 'processed',
      status_detail: 'processed',
      external_reference: 'TXN-ABC-123',
      transactions: { payments: [{ id: 'PAY9' }] },
    });
    const res = await handle(
      req('GET', '/api/mercadopago/point/orders/ORD1'),
      makeDeps({ fetch: mp.fetch })
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'processed');
    assert.equal(res.body.paymentId, 'PAY9');
    assert.equal(mp.calls[0].url, 'https://api.mercadopago.com/v1/orders/ORD1');
  });

  test('an id with odd characters is refused before reaching Mercado Pago', async () => {
    const mp = recordingFetch(200, {});
    const res = await handle(
      req('GET', `/api/mercadopago/point/orders/${encodeURIComponent('a b?x=1')}`),
      makeDeps({ fetch: mp.fetch })
    );
    assert.equal(res.status, 400);
    assert.equal(mp.calls.length, 0);
  });

  test('upstream error → 502', async () => {
    const res = await handle(
      req('GET', '/api/mercadopago/point/orders/ORD1'),
      makeDeps({ fetch: recordingFetch(404, {}).fetch })
    );
    assert.equal(res.status, 502);
  });
});

describe('POST /api/mercadopago/point/orders/:id/cancel', () => {
  test('upstream 200 (created) → cancelled now, pending=false', async () => {
    const mp = recordingFetch(200, { id: 'ORD1', status: 'canceled' });
    const res = await handle(
      req('POST', '/api/mercadopago/point/orders/ORD1/cancel'),
      makeDeps({ fetch: mp.fetch })
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'canceled');
    assert.equal(res.body.pending, false);
    assert.equal(mp.calls[0].init.headers['x-allow-cancelable-status'], 'at_terminal');
    assert.equal(mp.calls[0].init.headers['X-Idempotency-Key'], 'point-cancel-ORD1');
  });

  test('upstream 202 (at_terminal) → pending=true, never reported as cancelled', async () => {
    const mp = recordingFetch(202, { id: 'ORD1', status: 'at_terminal' });
    const res = await handle(
      req('POST', '/api/mercadopago/point/orders/ORD1/cancel'),
      makeDeps({ fetch: mp.fetch })
    );
    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'at_terminal');
    assert.equal(res.body.pending, true);
  });

  test('upstream error → 502', async () => {
    const res = await handle(
      req('POST', '/api/mercadopago/point/orders/ORD1/cancel'),
      makeDeps({ fetch: recordingFetch(500, {}).fetch })
    );
    assert.equal(res.status, 502);
  });
});

describe('POST /api/mercadopago/webhook', () => {
  const WH_SECRET = 'webhook-secret-for-tests';
  const ORDER_ID = 'ORD01M6GVF6K7Z2E648KXKQXSXVJW';

  function sign({ id = ORDER_ID, requestId = 'req-1', ts = '1700000000', secret = WH_SECRET }) {
    const manifest =
      `id:${id.toLowerCase()};` + (requestId ? `request-id:${requestId};` : '') + `ts:${ts};`;
    return `ts=${ts},v1=${createHmac('sha256', secret).update(manifest).digest('hex')}`;
  }

  const webhook = (overrides = {}) => ({
    method: 'POST',
    path: '/api/mercadopago/webhook',
    authorization: undefined,
    internalSecret: undefined,
    query: `data.id=${ORDER_ID}&type=order`,
    mpSignature: sign({}),
    mpRequestId: 'req-1',
    body: {
      action: 'order.canceled',
      data: {
        id: ORDER_ID,
        status: 'canceled',
        external_reference: 'TXN-ABC-123',
        transactions: { payments: [{ id: 'PAY1' }] },
      },
    },
    ...overrides,
  });

  const depsWithCache = (overrides = {}) =>
    makeDeps({ mpWebhookSecret: WH_SECRET, mpPointOrderCache: new Map(), ...overrides });

  test('routes without a staff token', () => {
    assert.deepEqual(matchRoute('POST', '/api/mercadopago/webhook'), {
      kind: 'mercadoPagoWebhook',
    });
    assert.equal(matchRoute('GET', '/api/mercadopago/webhook'), null);
  });

  test('503 when no webhook secret is configured', async () => {
    const res = await handle(webhook(), makeDeps());
    assert.equal(res.status, 503);
  });

  test('a valid signature records the order and answers 200', async () => {
    const deps = depsWithCache();
    const res = await handle(webhook(), deps);
    assert.equal(res.status, 200);
    assert.deepEqual(deps.mpPointOrderCache.get(ORDER_ID), {
      id: ORDER_ID,
      status: 'canceled',
      statusDetail: '',
      externalReference: 'TXN-ABC-123',
      paymentId: 'PAY1',
    });
  });

  test('signs the lower-cased data.id, as the docs require', async () => {
    const res = await handle(
      webhook({ query: `data.id=${ORDER_ID}`, mpSignature: sign({ id: ORDER_ID.toLowerCase() }) }),
      depsWithCache()
    );
    assert.equal(res.status, 200);
  });

  test('drops request-id from the manifest when the header is absent', async () => {
    const deps = depsWithCache();
    const res = await handle(
      webhook({ mpRequestId: undefined, mpSignature: sign({ requestId: '' }) }),
      deps
    );
    assert.equal(res.status, 200);
    assert.ok(deps.mpPointOrderCache.has(ORDER_ID));
  });

  test('rejects a bad, missing, malformed or wrong-secret signature without caching', async () => {
    for (const mpSignature of [
      undefined,
      'garbage',
      'ts=1700000000,v1=deadbeef',
      sign({ secret: 'other-secret' }),
      sign({ ts: '1' }).replace('ts=1,', 'ts=2,'),
    ]) {
      const deps = depsWithCache();
      const res = await handle(webhook({ mpSignature }), deps);
      assert.equal(res.status, 401);
      assert.equal(deps.mpPointOrderCache.size, 0);
    }
  });

  test('rejects a signature made for a different order id or request id', async () => {
    const deps = depsWithCache();
    assert.equal((await handle(webhook({ mpRequestId: 'req-2' }), deps)).status, 401);
    assert.equal(
      (await handle(webhook({ query: 'data.id=ORDOTHER&type=order' }), deps)).status,
      401
    );
  });

  test('rejects a missing or invalid data.id', async () => {
    const deps = depsWithCache();
    assert.equal((await handle(webhook({ query: 'type=order' }), deps)).status, 401);
    assert.equal((await handle(webhook({ query: undefined }), deps)).status, 401);
  });

  test('ignores a body whose order does not match data.id', async () => {
    const deps = depsWithCache();
    const res = await handle(
      webhook({ body: { data: { id: 'ORDOTHER', status: 'processed' } } }),
      deps
    );
    assert.equal(res.status, 200);
    assert.equal(deps.mpPointOrderCache.size, 0);
  });

  test('ignores statuses the till does not act on', async () => {
    const deps = depsWithCache();
    const res = await handle(
      webhook({ body: { data: { id: ORDER_ID, status: 'at_terminal' } } }),
      deps
    );
    assert.equal(res.status, 200);
    assert.equal(deps.mpPointOrderCache.size, 0);
  });

  test('a replayed older message cannot undo a refund', async () => {
    const deps = depsWithCache();
    await handle(webhook({ body: { data: { id: ORDER_ID, status: 'refunded' } } }), deps);
    await handle(webhook(), deps);
    assert.equal(deps.mpPointOrderCache.get(ORDER_ID).status, 'refunded');
  });

  test('keeps the cache bounded', async () => {
    const deps = depsWithCache();
    for (let i = 0; i < 250; i++) {
      const id = `ORD${i}`;
      await handle(
        webhook({
          query: `data.id=${id}&type=order`,
          mpSignature: sign({ id }),
          body: { data: { id, status: 'processed' } },
        }),
        deps
      );
    }
    assert.equal(deps.mpPointOrderCache.size, 200);
    assert.ok(!deps.mpPointOrderCache.has('ORD0'));
    assert.ok(deps.mpPointOrderCache.has('ORD249'));
  });

  test('GET status prefers the webhook-confirmed order over the upstream', async () => {
    const deps = depsWithCache();
    await handle(webhook(), deps);
    const { fetch, calls } = recordingFetch(200, { id: ORDER_ID, status: 'at_terminal' });

    const res = await handle(req('GET', `/api/mercadopago/point/orders/${ORDER_ID}`), {
      ...deps,
      fetch,
    });

    assert.equal(res.status, 200);
    assert.equal(res.body.status, 'canceled');
    assert.equal(calls.length, 0);
  });
});
