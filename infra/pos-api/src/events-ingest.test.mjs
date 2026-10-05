import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handle, matchRoute } from './api.ts';
import { signToken } from './session-auth.ts';
import { MemoryStore } from '../../shared/src/document-store.ts';
import { MemoryImageStore } from '../../shared/src/image-store.ts';
import { MAX_EVENTS_PER_BATCH } from './events-ingest.ts';

const SECRET = 'test-secret-at-least-32-characters-long';
const NOW = 1_700_000_000;
const FUTURE = NOW + 3600;
const ISO = new Date(NOW * 1000).toISOString();

/** A staff session token, which carries no `type` claim. */
function staffToken(permissions = ['sale:process'], tenantId = 'tenant-1') {
  const b64url = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const body = b64url({ sub: 'op-1', tenantId, roles: ['cashier'], permissions, exp: FUTURE });
  const sig = createHmac('sha256', SECRET).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}
const deviceToken = (tenantId = 'tenant-1') =>
  signToken({ sub: 'terminal-1', type: 'kiosk-device', tenantId, exp: FUTURE }, SECRET);
const shopToken = (tenantId = 'tenant-1') =>
  signToken({ sub: 'store-1', type: 'shop-session', tenantId, exp: FUTURE }, SECRET);

function product(id, stock) {
  return {
    id,
    name: id,
    price: 2,
    category: 'feed',
    stock,
    description: '',
    createdAt: ISO,
    updatedAt: ISO,
  };
}

function kioskSale(clientTransactionId, items, tenantId = 'tenant-1') {
  return {
    id: `kiosk-${clientTransactionId}`,
    type: 'kiosk-sale',
    items: items.map((item) => ({
      productName: item.productId,
      unitPrice: 2,
      lineTotal: 2,
      ...item,
    })),
    subtotal: 2,
    taxAmount: 0,
    total: 2,
    paymentMethod: 'card',
    terminalId: 'terminal-1',
    timestamp: ISO,
    operatorId: 'terminal-1',
    tenantId,
    clientTransactionId,
  };
}

function saleEvent(eventId, transactionId, items) {
  return {
    eventId,
    type: 'sale.completed',
    payload: {
      transactionId,
      items: items.map((item) => ({ unitPrice: 2, ...item })),
      amount: 2,
      method: 'card',
      occurredAt: ISO,
    },
  };
}

function makeDeps({
  products = [product('oats', 10), product('hay', 10)],
  transactions = [],
  enabled = true,
} = {}) {
  return {
    products: new MemoryStore(products),
    transactions: new MemoryStore(transactions),
    roles: new MemoryStore(),
    imageStore: new MemoryImageStore(),
    secret: SECRET,
    appId: undefined,
    internalSecret: 'int-secret',
    mpAccessToken: '',
    mpCurrencyId: 'MXN',
    appBaseUrl: 'http://localhost:4200',
    eventsIngestEnabled: enabled,
    nowSeconds: () => NOW,
    nowIso: () => ISO,
    newId: () => 'id-' + Math.random().toString(36).slice(2),
  };
}

const post = (token, body) => ({
  method: 'POST',
  path: '/api/events',
  authorization: token === undefined ? undefined : `Bearer ${token}`,
  internalSecret: undefined,
  body,
});
const stockOf = async (deps, id) => (await deps.products.read(id)).document.stock;

describe('POST /api/events (#358)', () => {
  test('routes POST /api/events to ingestEvents, and nothing else', () => {
    assert.deepEqual(matchRoute('POST', '/api/events'), { kind: 'ingestEvents' });
    assert.equal(matchRoute('GET', '/api/events'), null);
  });

  test('answers 404 when EVENTS_INGEST_ENABLED is off, before even checking the token', async () => {
    const deps = makeDeps({ enabled: false });
    const res = await handle(post(undefined, { events: [] }), deps);
    assert.equal(res.status, 404);
  });

  test('no token → 401; a staff role without PROCESS_SALE → 403', async () => {
    const deps = makeDeps();
    const event = saleEvent('e-1', 'TXN-1', [{ productId: 'oats', quantity: 1 }]);

    assert.equal((await handle(post(undefined, { events: [event] }), deps)).status, 401);
    assert.equal((await handle(post('not-a-jwt', { events: [event] }), deps)).status, 401);
    assert.equal(
      (await handle(post(staffToken(['inventory:view']), { events: [event] }), deps)).status,
      403
    );
    assert.equal(await stockOf(deps, 'oats'), 10);
  });

  test('rejects an empty batch, a missing events array, and more than the batch limit', async () => {
    const deps = makeDeps();
    const token = staffToken();
    const many = Array.from({ length: MAX_EVENTS_PER_BATCH + 1 }, (_, i) =>
      saleEvent(`e-${i}`, `TXN-${i}`, [{ productId: 'oats', quantity: 1 }])
    );

    assert.equal((await handle(post(token, { events: [] }), deps)).status, 400);
    assert.equal((await handle(post(token, {}), deps)).status, 400);
    assert.equal((await handle(post(token, { events: many }), deps)).status, 400);
    assert.equal(await stockOf(deps, 'oats'), 10);
  });

  test('a mixed staff batch answers 200 with a result per event', async () => {
    const deps = makeDeps();
    const token = staffToken();
    const first = saleEvent('e-1', 'TXN-1', [{ productId: 'oats', quantity: 2 }]);

    await handle(post(token, { events: [first] }), deps);
    const res = await handle(
      post(token, {
        events: [
          first, // replay
          saleEvent('e-2', 'TXN-2', [{ productId: 'hay', quantity: 3 }]),
          saleEvent('e-1', 'TXN-1', [{ productId: 'oats', quantity: 9 }]), // same id, new payload
          { eventId: 'e-3', type: 'sale.completed', payload: { items: [] } }, // malformed
        ],
      }),
      deps
    );

    assert.equal(res.status, 200);
    assert.deepEqual(
      res.body.results.map((r) => [r.eventId, r.status]),
      [
        ['e-1', 'duplicate'],
        ['e-2', 'applied'],
        ['e-1', 'conflict'],
        ['e-3', 'rejected'],
      ]
    );
    assert.equal(await stockOf(deps, 'oats'), 8);
    assert.equal(await stockOf(deps, 'hay'), 7);
  });

  test('a store failure on one event answers retry for it and still applies the rest', async () => {
    const deps = makeDeps();
    const read = deps.products.read.bind(deps.products);
    deps.products.read = async (id) => {
      if (id === 'hay') throw new Error('Cloudant unreachable');
      return read(id);
    };
    const res = await handle(
      post(staffToken(), {
        events: [
          saleEvent('e-1', 'TXN-1', [{ productId: 'hay', quantity: 1 }]),
          saleEvent('e-2', 'TXN-2', [{ productId: 'oats', quantity: 1 }]),
        ],
      }),
      deps
    );

    assert.deepEqual(
      res.body.results.map((r) => r.status),
      ['retry', 'applied']
    );
  });

  test('the token tenant, not anything the client sends, owns the event', async () => {
    const deps = makeDeps();
    const event = {
      ...saleEvent('e-1', 'TXN-1', [{ productId: 'oats', quantity: 1 }]),
      tenantId: 'tenant-2',
    };

    const res = await handle(post(staffToken(), { events: [event] }), deps);

    assert.equal(res.body.results[0].status, 'rejected');
    assert.equal(await stockOf(deps, 'oats'), 10);
  });

  test('sale-event records never show up in transaction history', async () => {
    const deps = makeDeps();
    await handle(
      post(staffToken(), {
        events: [saleEvent('e-1', 'TXN-1', [{ productId: 'oats', quantity: 1 }])],
      }),
      deps
    );

    const history = await handle(
      {
        method: 'GET',
        path: '/api/transactions',
        authorization: `Bearer ${staffToken(['sale:view_transactions'])}`,
        internalSecret: undefined,
        body: undefined,
      },
      deps
    );

    assert.equal(history.status, 200);
    assert.equal(history.body.count, 0);
  });

  describe('kiosk-device and shop-session tokens (the guardrail)', () => {
    for (const [kind, token] of [
      ['kiosk-device', deviceToken],
      ['shop-session', shopToken],
    ]) {
      test(`${kind}: a made-up sale is rejected and touches no stock`, async () => {
        const deps = makeDeps();

        const res = await handle(
          post(token(), {
            events: [saleEvent('e-1', 'TXN-FAKE', [{ productId: 'oats', quantity: 9 }])],
          }),
          deps
        );

        assert.equal(res.status, 200);
        assert.equal(res.body.results[0].status, 'rejected');
        assert.equal(await stockOf(deps, 'oats'), 10);
      });

      test(`${kind}: a sale matching a recorded transaction is applied once`, async () => {
        const items = [{ productId: 'oats', quantity: 2 }];
        const deps = makeDeps({ transactions: [kioskSale('TXN-K', items)] });
        const event = saleEvent('e-1', 'TXN-K', items);

        const first = await handle(post(token(), { events: [event] }), deps);
        const again = await handle(post(token(), { events: [event] }), deps);

        assert.equal(first.body.results[0].status, 'applied');
        assert.equal(again.body.results[0].status, 'duplicate');
        assert.equal(await stockOf(deps, 'oats'), 8);
      });
    }

    test('rejects an event naming a product outside the recorded sale', async () => {
      const deps = makeDeps({
        transactions: [kioskSale('TXN-K', [{ productId: 'oats', quantity: 2 }])],
      });

      const res = await handle(
        post(deviceToken(), {
          events: [
            saleEvent('e-1', 'TXN-K', [
              { productId: 'oats', quantity: 2 },
              { productId: 'hay', quantity: 5 },
            ]),
          ],
        }),
        deps
      );

      assert.equal(res.body.results[0].status, 'rejected');
      assert.equal(await stockOf(deps, 'hay'), 10);
      assert.equal(await stockOf(deps, 'oats'), 10);
    });

    test('rejects an event that leaves out part of the recorded sale', async () => {
      const deps = makeDeps({
        transactions: [
          kioskSale('TXN-K', [
            { productId: 'oats', quantity: 2 },
            { productId: 'hay', quantity: 1 },
          ]),
        ],
      });

      const res = await handle(
        post(deviceToken(), {
          events: [saleEvent('e-1', 'TXN-K', [{ productId: 'oats', quantity: 2 }])],
        }),
        deps
      );

      assert.equal(res.body.results[0].status, 'rejected');
      assert.equal(await stockOf(deps, 'oats'), 10);
    });

    test('rejects an event whose quantities differ from the recorded sale', async () => {
      const deps = makeDeps({
        transactions: [kioskSale('TXN-K', [{ productId: 'oats', quantity: 2 }])],
      });

      const res = await handle(
        post(deviceToken(), {
          events: [saleEvent('e-1', 'TXN-K', [{ productId: 'oats', quantity: 7 }])],
        }),
        deps
      );

      assert.equal(res.body.results[0].status, 'rejected');
      assert.equal(await stockOf(deps, 'oats'), 10);
    });

    test('rejects a sale recorded under another tenant', async () => {
      const items = [{ productId: 'oats', quantity: 2 }];
      const deps = makeDeps({ transactions: [kioskSale('TXN-K', items, 'tenant-2')] });

      const res = await handle(
        post(deviceToken('tenant-1'), { events: [saleEvent('e-1', 'TXN-K', items)] }),
        deps
      );

      assert.equal(res.body.results[0].status, 'rejected');
    });
  });

  test('POST /api/transactions keeps the till transaction id the guardrail matches on', async () => {
    const deps = makeDeps();

    const res = await handle(
      {
        method: 'POST',
        path: '/api/transactions',
        authorization: `Bearer ${deviceToken()}`,
        internalSecret: undefined,
        body: {
          transactionId: 'TXN-TILL-7',
          paymentMethod: 'card',
          subtotal: 2,
          taxAmount: 0,
          total: 2,
          items: [
            { productId: 'oats', productName: 'Oats', quantity: 1, unitPrice: 2, lineTotal: 2 },
          ],
        },
      },
      deps
    );

    assert.equal(res.status, 201);
    assert.equal(res.body.transaction.clientTransactionId, 'TXN-TILL-7');
  });
});
