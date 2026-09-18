import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  assertCheckoutQuote,
  majorUnitsToMinorUnits,
  parseCheckoutCreateRequest,
  priceCheckout,
} from './checkout-pricing.ts';

const POLICY = {
  currency: 'USD',
  taxRateBasisPoints: 850,
  maxItemQuantity: 10_000,
  maxAggregateQuantity: 50_000,
  maxTotalMinorUnits: 100_000_000,
};

describe('checkout request validation', () => {
  it('accepts only unique product id and positive quantity fields', () => {
    assert.deepEqual(parseCheckoutCreateRequest({ items: [{ productId: 'p-1', quantity: 2 }] }), {
      items: [{ productId: 'p-1', quantity: 2 }],
    });
    assert.throws(() => parseCheckoutCreateRequest({ items: [], total: 10 }));
    assert.throws(() =>
      parseCheckoutCreateRequest({ items: [{ productId: 'p-1', quantity: 1, price: 1 }] })
    );
    assert.throws(() =>
      parseCheckoutCreateRequest({
        items: [
          { productId: 'p-1', quantity: 1 },
          { productId: 'p-1', quantity: 2 },
        ],
      })
    );
    assert.throws(() =>
      parseCheckoutCreateRequest({ items: [{ productId: 'p-1', quantity: 1.5 }] })
    );
  });

  it('keeps catalogue ids opaque while bounding unsafe input', () => {
    const productId = ' aisle/日本語 item ';
    assert.equal(
      parseCheckoutCreateRequest({ items: [{ productId, quantity: 1 }] }).items[0].productId,
      productId
    );
    assert.throws(() =>
      parseCheckoutCreateRequest({ items: [{ productId: 'bad\nitem', quantity: 1 }] })
    );
    assert.throws(() =>
      parseCheckoutCreateRequest({ items: [{ productId: 'x'.repeat(201), quantity: 1 }] })
    );
  });

  it('enforces configured line and aggregate quantity caps', () => {
    const limits = { maxItemQuantity: 2, maxAggregateQuantity: 3 };
    assert.doesNotThrow(() =>
      parseCheckoutCreateRequest(
        {
          items: [
            { productId: 'one', quantity: 2 },
            { productId: 'two', quantity: 1 },
          ],
        },
        limits
      )
    );
    assert.throws(() =>
      parseCheckoutCreateRequest({ items: [{ productId: 'one', quantity: 3 }] }, limits)
    );
    assert.throws(() =>
      parseCheckoutCreateRequest(
        {
          items: [
            { productId: 'one', quantity: 2 },
            { productId: 'two', quantity: 2 },
          ],
        },
        limits
      )
    );
  });
});

describe('authoritative checkout pricing', () => {
  const products = new Map([
    ['p-1', { id: 'p-1', name: 'Oats', price: 1.01 }],
    ['p-2', { id: 'p-2', name: 'Milk', price: 0.99 }],
  ]);

  it('converts decimal cent values exactly and rejects fractional cents or unsafe values', () => {
    assert.equal(majorUnitsToMinorUnits(1.01), 101);
    assert.equal(majorUnitsToMinorUnits(0.29), 29);
    assert.equal(majorUnitsToMinorUnits(2.3), 230);
    assert.equal(majorUnitsToMinorUnits(1e-2), 1);
    for (const price of [Number.NaN, Infinity, -1, 1.001, 1.005, Number.MAX_SAFE_INTEGER]) {
      assert.throws(() => majorUnitsToMinorUnits(price));
    }
  });

  it('uses checked minor-unit arithmetic and rounds basket tax half-up once', () => {
    const request = parseCheckoutCreateRequest({
      items: [
        { productId: 'p-1', quantity: 1 },
        { productId: 'p-2', quantity: 1 },
      ],
    });
    const quote = priceCheckout(request, products, POLICY);
    assert.equal(quote.subtotalMinorUnits, 200);
    assert.equal(quote.taxMinorUnits, 17);
    assert.equal(quote.totalMinorUnits, 217);
    assert.doesNotThrow(() => assertCheckoutQuote(quote));
  });

  it('rejects direct duplicate lines, inactive products, and non-USD policy', () => {
    assert.throws(() =>
      priceCheckout(
        {
          items: [
            { productId: 'p-1', quantity: 1 },
            { productId: 'p-1', quantity: 1 },
          ],
        },
        products,
        POLICY
      )
    );
    assert.throws(() =>
      priceCheckout(
        { items: [{ productId: 'inactive', quantity: 1 }] },
        new Map([['inactive', { id: 'inactive', name: 'Hidden', price: 1, isActive: false }]]),
        POLICY
      )
    );
    assert.throws(() =>
      priceCheckout({ items: [{ productId: 'p-1', quantity: 1 }] }, products, {
        ...POLICY,
        currency: 'EUR',
      })
    );
  });

  it('enforces configured totals and strictly validates durable quotes', () => {
    const request = parseCheckoutCreateRequest({ items: [{ productId: 'p-1', quantity: 1 }] });
    assert.throws(() => priceCheckout(request, products, { ...POLICY, maxTotalMinorUnits: 10 }));
    const quote = priceCheckout(request, products, POLICY);
    assert.throws(() =>
      assertCheckoutQuote({ ...quote, totalMinorUnits: quote.totalMinorUnits + 1 })
    );
    assert.throws(() => assertCheckoutQuote({ ...quote, currency: 'EUR' }));
    assert.throws(() => assertCheckoutQuote({ ...quote, browserTotal: quote.totalMinorUnits }));
    assert.throws(() =>
      assertCheckoutQuote({ ...quote, lines: [...quote.lines, { ...quote.lines[0] }] })
    );
    assert.throws(() =>
      assertCheckoutQuote({
        ...quote,
        lines: [{ ...quote.lines[0], productId: 'bad\u0000id' }],
      })
    );
  });
});
