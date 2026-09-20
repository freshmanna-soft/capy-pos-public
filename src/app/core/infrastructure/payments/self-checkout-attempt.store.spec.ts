import { TestBed } from '@angular/core/testing';
import { SelfCheckoutAttemptStore } from './self-checkout-attempt.store';

const attempt = {
  checkoutId: 'checkout-1',
  paypalOrderId: 'order-1',
  checkoutToken: 'capability-1',
  state: 'awaiting-approval' as const,
  cartRevision: 7,
  items: [{ productId: 'product-1', quantity: 2 }],
  idempotencyKey: 'idempotency-1',
  quote: {
    currency: 'USD' as const,
    taxRateBasisPoints: 850,
    lines: [
      {
        productId: 'product-1',
        productName: 'Coffee',
        quantity: 2,
        unitPriceMinorUnits: 450,
        subtotalMinorUnits: 900,
      },
    ],
    subtotalMinorUnits: 900,
    taxMinorUnits: 77,
    totalMinorUnits: 977,
  },
};

describe('SelfCheckoutAttemptStore', () => {
  let store: SelfCheckoutAttemptStore;

  beforeEach(() => {
    sessionStorage.clear();
    TestBed.configureTestingModule({ providers: [SelfCheckoutAttemptStore] });
    store = TestBed.inject(SelfCheckoutAttemptStore);
  });

  it('round trips a valid recovery attempt', () => {
    store.write(attempt);
    expect(store.read()).toEqual(attempt);
  });

  it.each([
    { ...attempt, checkoutToken: '' },
    { ...attempt, cartRevision: -1 },
    { ...attempt, items: [{ productId: '', quantity: 2 }] },
    { ...attempt, items: [{ productId: 'product-1', quantity: 0 }] },
    { ...attempt, quote: { ...attempt.quote, totalMinorUnits: 1 } },
  ])('rejects malformed persisted capabilities and facts', (invalid) => {
    sessionStorage.setItem('capy_pos_self_checkout_attempt', JSON.stringify(invalid));
    expect(store.read()).toBeNull();
  });

  it('clears the persisted capability', () => {
    store.write(attempt);
    store.clear();
    expect(store.read()).toBeNull();
  });

  it('fails closed when browser storage throws', () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(store.read()).toBeNull();
    read.mockRestore();
  });
});
