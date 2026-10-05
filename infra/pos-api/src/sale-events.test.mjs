import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../shared/src/document-store.ts';
import { applySaleEvent, saleEventId, SALE_EVENT_CAS_ATTEMPTS } from './sale-events.ts';

const NOW = '2026-10-05T12:00:00.000Z';
const CLAIMS = Object.freeze({ tenantId: 'store-1', operatorId: 'till-1' });

function product(id, stock, extra = {}) {
  return {
    id,
    name: id,
    price: 2,
    category: 'feed',
    stock,
    description: '',
    createdAt: NOW,
    updatedAt: NOW,
    ...extra,
  };
}

function event(overrides = {}, payloadOverrides = {}) {
  return {
    eventId: 'evt-1',
    type: 'sale.completed',
    payload: {
      transactionId: 'TXN-1',
      items: [
        { productId: 'oats', quantity: 2, unitPrice: 2 },
        { productId: 'hay', quantity: 1, unitPrice: 2 },
      ],
      amount: 6,
      method: 'cash',
      occurredAt: '2026-10-05T11:59:00.000Z',
      ...payloadOverrides,
    },
    ...overrides,
  };
}

/**
 * A MemoryStore whose next `write`s can be made to fail. `crash` throws, standing in
 * for a process dying mid-request; `conflict` reports a lost `_rev` race.
 */
function faultyStore(seed) {
  const store = new MemoryStore(seed);
  const faults = [];
  const writes = { count: 0 };
  return {
    store: {
      list: () => store.list(),
      read: (id) => store.read(id),
      create: (doc) => store.create(doc),
      remove: (id, rev) => store.remove(id, rev),
      async write(doc, rev) {
        writes.count += 1;
        const fault = faults.shift();
        if (fault === 'crash') throw new Error('process died');
        if (fault === 'conflict') return 'conflict';
        return store.write(doc, rev);
      },
    },
    raw: store,
    faults,
    writes,
  };
}

function context(products = [product('oats', 10), product('hay', 5)]) {
  const productStore = faultyStore(products);
  const eventStore = faultyStore([]);
  const deps = {
    products: productStore.store,
    saleEvents: eventStore.store,
    nowIso: () => NOW,
  };
  const stockOf = async (id) => (await productStore.raw.read(id)).document.stock;
  const productDoc = async (id) => (await productStore.raw.read(id)).document;
  return { deps, productStore, eventStore, stockOf, productDoc };
}

describe('applySaleEvent', () => {
  it('applies a sale once, marks each product and records the event', async () => {
    const { deps, stockOf, productDoc, eventStore } = context();

    const result = await applySaleEvent(event(), CLAIMS, deps);

    assert.deepEqual(result, { eventId: 'evt-1', status: 'applied', oversold: [], missing: [] });
    assert.equal(await stockOf('oats'), 8);
    assert.equal(await stockOf('hay'), 4);
    assert.deepEqual((await productDoc('oats')).eventMarkers, {
      'evt-1': { quantity: 2, appliedAt: NOW },
    });
    const record = (await eventStore.raw.read(saleEventId('evt-1'))).document;
    assert.equal(record.status, 'applied');
    assert.equal(record.tenantId, 'store-1');
    assert.equal(record.transactionId, 'TXN-1');
  });

  it('decrements once however many times the same event is replayed', async () => {
    const { deps, stockOf } = context();

    const first = await applySaleEvent(event(), CLAIMS, deps);
    const replays = [];
    for (let i = 0; i < 5; i += 1) replays.push(await applySaleEvent(event(), CLAIMS, deps));

    assert.equal(first.status, 'applied');
    assert.ok(replays.every((r) => r.status === 'duplicate'));
    assert.equal(await stockOf('oats'), 8);
    assert.equal(await stockOf('hay'), 4);
  });

  it('answers conflict for the same id with a different payload, and writes nothing', async () => {
    const { deps, stockOf } = context();
    await applySaleEvent(event(), CLAIMS, deps);

    const result = await applySaleEvent(
      event({}, { items: [{ productId: 'oats', quantity: 9, unitPrice: 2 }] }),
      CLAIMS,
      deps
    );

    assert.equal(result.status, 'conflict');
    assert.equal(await stockOf('oats'), 8);
  });

  it('treats item order as the same payload', async () => {
    const { deps } = context();
    await applySaleEvent(event(), CLAIMS, deps);

    const reordered = event(
      {},
      {
        items: [
          { productId: 'hay', quantity: 1, unitPrice: 2 },
          { productId: 'oats', quantity: 2, unitPrice: 2 },
        ],
      }
    );

    assert.equal((await applySaleEvent(reordered, CLAIMS, deps)).status, 'duplicate');
  });

  it('converges after a crash once the event is recorded but before any product write', async () => {
    const { deps, productStore, stockOf } = context();
    productStore.faults.push('crash');

    await assert.rejects(() => applySaleEvent(event(), CLAIMS, deps), /process died/);
    assert.equal(await stockOf('oats'), 10);

    assert.equal((await applySaleEvent(event(), CLAIMS, deps)).status, 'applied');
    assert.equal(await stockOf('oats'), 8);
    assert.equal(await stockOf('hay'), 4);
  });

  it('converges after a crash between product writes without decrementing twice', async () => {
    const { deps, productStore, stockOf } = context();
    // Lines are applied in product-id order: hay is written, then the process dies
    // writing oats.
    productStore.faults.push(undefined, 'crash');

    await assert.rejects(() => applySaleEvent(event(), CLAIMS, deps), /process died/);
    assert.equal(await stockOf('hay'), 4);
    assert.equal(await stockOf('oats'), 10);

    assert.equal((await applySaleEvent(event(), CLAIMS, deps)).status, 'applied');
    assert.equal(await stockOf('oats'), 8);
    assert.equal(await stockOf('hay'), 4);
  });

  it('converges after a crash between the product writes and marking the event applied', async () => {
    const { deps, eventStore, stockOf } = context();
    eventStore.faults.push('crash');

    await assert.rejects(() => applySaleEvent(event(), CLAIMS, deps), /process died/);
    assert.equal(await stockOf('oats'), 8);

    assert.equal((await applySaleEvent(event(), CLAIMS, deps)).status, 'applied');
    assert.equal(await stockOf('oats'), 8);
    assert.equal((await applySaleEvent(event(), CLAIMS, deps)).status, 'duplicate');
  });

  it('re-reads and retries after a forced _rev conflict', async () => {
    const { deps, productStore, stockOf } = context();
    productStore.faults.push('conflict', 'conflict');

    assert.equal((await applySaleEvent(event(), CLAIMS, deps)).status, 'applied');
    assert.equal(await stockOf('oats'), 8);
  });

  it('answers retry when a product stays contended, and a later replay finishes', async () => {
    const { deps, productStore, stockOf } = context();
    for (let i = 0; i < SALE_EVENT_CAS_ATTEMPTS; i += 1) productStore.faults.push('conflict');

    assert.equal((await applySaleEvent(event(), CLAIMS, deps)).status, 'retry');
    assert.equal(await stockOf('oats'), 10);

    assert.equal((await applySaleEvent(event(), CLAIMS, deps)).status, 'applied');
    assert.equal(await stockOf('oats'), 8);
  });

  it('rejects an event whose tenant differs from the token', async () => {
    const { deps, stockOf, eventStore } = context();

    const result = await applySaleEvent(event({ tenantId: 'store-2' }), CLAIMS, deps);

    assert.equal(result.status, 'rejected');
    assert.equal(await stockOf('oats'), 10);
    assert.equal(await eventStore.raw.read(saleEventId('evt-1')), null);
  });

  it('answers conflict when another tenant already used the event id', async () => {
    const { deps } = context();
    await applySaleEvent(event(), CLAIMS, deps);

    const result = await applySaleEvent(event(), { tenantId: 'store-2', operatorId: 'x' }, deps);

    assert.equal(result.status, 'conflict');
  });

  it('rejects a malformed event without writing anything', async () => {
    const { deps, eventStore } = context();
    const malformed = [
      event({ eventId: '' }),
      event({ type: 'product.upserted' }),
      event({}, { items: [] }),
      event({}, { items: [{ productId: 'oats', quantity: 0, unitPrice: 2 }] }),
      event({}, { items: [{ productId: 'oats', quantity: 1.5, unitPrice: 2 }] }),
      event({}, { items: [{ productId: '', quantity: 1, unitPrice: 2 }] }),
      event({}, { transactionId: '' }),
    ];

    for (const bad of malformed) {
      assert.equal((await applySaleEvent(bad, CLAIMS, deps)).status, 'rejected');
    }
    assert.equal((await eventStore.raw.list()).length, 0);
  });

  it('merges repeated lines for one product into a single decrement', async () => {
    const { deps, stockOf, productDoc } = context();

    await applySaleEvent(
      event(
        {},
        {
          items: [
            { productId: 'oats', quantity: 2, unitPrice: 2 },
            { productId: 'oats', quantity: 3, unitPrice: 2 },
          ],
        }
      ),
      CLAIMS,
      deps
    );

    assert.equal(await stockOf('oats'), 5);
    assert.equal((await productDoc('oats')).eventMarkers['evt-1'].quantity, 5);
  });

  it('applies the rest of the sale and reports a product that no longer exists', async () => {
    const { deps, stockOf } = context();

    const result = await applySaleEvent(
      event(
        {},
        {
          items: [
            { productId: 'oats', quantity: 2, unitPrice: 2 },
            { productId: 'ghost', quantity: 1, unitPrice: 2 },
          ],
        }
      ),
      CLAIMS,
      deps
    );

    assert.equal(result.status, 'applied');
    assert.deepEqual(result.missing, ['ghost']);
    assert.equal(await stockOf('oats'), 8);
  });

  describe('oversell (clamp at 0, record the shortfall)', () => {
    it('applies a sale larger than stock, floors stock at 0 and flags the product', async () => {
      const { deps, stockOf, productDoc } = context([product('oats', 1), product('hay', 5)]);

      const result = await applySaleEvent(event(), CLAIMS, deps);

      assert.equal(result.status, 'applied');
      assert.deepEqual(result.oversold, ['oats']);
      assert.equal(await stockOf('oats'), 0);
      const oats = await productDoc('oats');
      assert.equal(oats.oversold, true);
      assert.equal(oats.oversoldQuantity, 1);
      assert.equal((await productDoc('hay')).oversold, undefined);
    });

    it('accumulates the shortfall across oversold sales', async () => {
      const { deps, productDoc } = context([product('oats', 0), product('hay', 5)]);

      await applySaleEvent(event(), CLAIMS, deps);
      await applySaleEvent(event({ eventId: 'evt-2' }, { transactionId: 'TXN-2' }), CLAIMS, deps);

      assert.equal((await productDoc('oats')).oversoldQuantity, 4);
    });

    it('does not decrement or grow the shortfall when an oversold event is replayed', async () => {
      const { deps, stockOf, productDoc } = context([product('oats', 1), product('hay', 5)]);

      await applySaleEvent(event(), CLAIMS, deps);
      await applySaleEvent(event(), CLAIMS, deps);

      assert.equal(await stockOf('oats'), 0);
      assert.equal((await productDoc('oats')).oversoldQuantity, 1);
    });
  });
});
