import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { signal } from '@angular/core';
import { CartChangedDuringCheckoutError, PosFacade } from '@core/application/facades/pos.facade';
import {
  PAYPAL_CHECKOUT,
  PayPalCheckoutCallbacks,
} from '@core/application/ports/paypal-checkout.port';
import {
  SELF_CHECKOUT_GATEWAY,
  SelfCheckoutGateway,
  SelfCheckoutGatewayError,
  SelfCheckoutState,
} from '@core/application/ports/self-checkout-gateway.port';
import { SelfCheckoutAttemptStore } from '@core/infrastructure/payments/self-checkout-attempt.store';
import { SelfCheckoutPayComponent } from './self-checkout-pay.component';
import { LANE_ROUTE } from './self-checkout-routes';

const quote = {
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
};
const created = {
  checkoutId: 'checkout-1',
  paypalOrderId: 'order-1',
  checkoutToken: 'capability-1',
  state: SelfCheckoutState.AWAITING_APPROVAL,
  quote,
};
const completed = {
  checkoutId: 'checkout-1',
  state: SelfCheckoutState.COMPLETED,
  quote,
  paypalOrderId: 'order-1',
  receipt: {
    transactionId: 'transaction-1',
    checkoutId: 'checkout-1',
    quote,
    paypalCaptureId: 'capture-1',
    completedAt: '2026-09-02T12:00:00.000Z',
  },
  failure: null,
};

describe('SelfCheckoutPayComponent', () => {
  let callbacks: PayPalCheckoutCallbacks;
  let revision: ReturnType<typeof signal<number>>;
  let gateway: {
    create: ReturnType<typeof vi.fn>;
    status: ReturnType<typeof vi.fn>;
    complete: ReturnType<typeof vi.fn>;
  };
  let paypal: {
    initialize: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
    resumeIfReturned: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  };
  let pos: {
    cartItems: ReturnType<typeof signal<unknown[]>>;
    cartRevision: ReturnType<typeof signal<number>>;
    finalizeServerCheckout: ReturnType<typeof vi.fn>;
    serverCheckoutReceiptData: ReturnType<typeof vi.fn>;
  };
  const navigate = vi.fn();

  beforeEach(() => {
    sessionStorage.clear();
    navigate.mockReset();
    revision = signal(4);
    gateway = {
      create: vi.fn().mockResolvedValue(created),
      status: vi.fn(),
      complete: vi.fn().mockResolvedValue(completed),
    };
    paypal = {
      initialize: vi.fn().mockImplementation((next: PayPalCheckoutCallbacks) => {
        callbacks = next;
        return Promise.resolve(true);
      }),
      start: vi.fn().mockResolvedValue(undefined),
      resumeIfReturned: vi.fn().mockResolvedValue(false),
      destroy: vi.fn(),
    };
    const receiptData = {
      payment: {
        method: 'paypal',
        amount: 9.77,
        transactionId: 'transaction-1',
        timestamp: new Date('2026-09-02T12:00:00.000Z'),
      },
      items: [],
      currency: 'USD',
      subtotal: 9,
      tax: 0.77,
      taxRate: 0.085,
      total: 9.77,
    };
    pos = {
      cartItems: signal([
        { product: { id: 'product-1', name: 'Local name', price: 0.01 }, quantity: 2 },
      ]),
      cartRevision: revision,
      finalizeServerCheckout: vi.fn().mockReturnValue(receiptData),
      serverCheckoutReceiptData: vi.fn().mockReturnValue(receiptData),
    };

    TestBed.configureTestingModule({
      imports: [SelfCheckoutPayComponent],
      providers: [
        { provide: PosFacade, useValue: pos },
        { provide: SELF_CHECKOUT_GATEWAY, useValue: gateway as unknown as SelfCheckoutGateway },
        { provide: PAYPAL_CHECKOUT, useValue: paypal },
        SelfCheckoutAttemptStore,
        { provide: Router, useValue: { navigate } },
      ],
    });
  });

  async function render() {
    const fixture = TestBed.createComponent(SelfCheckoutPayComponent);
    fixture.detectChanges();
    await vi.waitFor(() =>
      expect(gateway.create.mock.calls.length + gateway.status.mock.calls.length).toBeGreaterThan(0)
    );
    await fixture.whenStable();
    await vi.waitFor(() => {
      fixture.detectChanges();
      expect(fixture.nativeElement.textContent).not.toContain(
        'Preparing your secure PayPal checkout'
      );
    });
    return fixture;
  }

  function storeAttempt(
    cartRevision = 4,
    attempt: typeof created = created,
    items: readonly { productId: string; quantity: number }[] = [
      { productId: 'product-1', quantity: 2 },
    ]
  ): void {
    sessionStorage.setItem(
      'capy_pos_self_checkout_attempt',
      JSON.stringify({
        ...attempt,
        cartRevision,
        items,
        idempotencyKey: 'idempotency-1',
      })
    );
  }

  it('creates from item identities and shows the authoritative server quote', async () => {
    const fixture = await render();

    expect(gateway.create).toHaveBeenCalledWith(
      [{ productId: 'product-1', quantity: 2 }],
      expect.any(String)
    );
    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-payment-total"]')
        ?.textContent
    ).toContain('9.77');
    expect(fixture.nativeElement.textContent).toContain('Coffee');
    expect(fixture.nativeElement.textContent).not.toContain('Local name');
  });

  it('retries an ambiguous create with the same idempotency key', async () => {
    gateway.create.mockRejectedValueOnce(new SelfCheckoutGatewayError('network-error', true, true));
    const fixture = await render();
    const firstKey = gateway.create.mock.calls[0][1];

    fixture.nativeElement.querySelector('[data-testid="self-checkout-payment-retry"]').click();
    await vi.waitFor(() => expect(gateway.create).toHaveBeenCalledTimes(2));

    expect(gateway.create.mock.calls[1][1]).toBe(firstKey);
  });

  it('starts the SDK with only the stored PayPal order id', async () => {
    const fixture = await render();
    fixture.nativeElement.querySelector('[data-testid="self-checkout-payment-paypal"]').click();
    await fixture.whenStable();

    expect(paypal.start).toHaveBeenCalledWith('order-1');
  });

  it('calls only server completion after PayPal approval and finalizes its receipt', async () => {
    const fixture = await render();

    await callbacks.onApprove();
    fixture.detectChanges();

    expect(gateway.complete).toHaveBeenCalledWith('checkout-1', 'capability-1');
    expect(pos.finalizeServerCheckout).toHaveBeenCalledWith(completed.receipt, 4);
    expect(fixture.nativeElement.querySelector('app-receipt')).not.toBeNull();
  });

  it('deduplicates repeated approval callbacks', async () => {
    let resolve!: (value: typeof completed) => void;
    gateway.complete.mockReturnValue(
      new Promise((next) => {
        resolve = next;
      })
    );
    await render();

    const first = callbacks.onApprove();
    const second = callbacks.onApprove();
    expect(gateway.complete).toHaveBeenCalledOnce();
    resolve(completed);
    await Promise.all([first, second]);
  });

  it('status-checks after ambiguous completion instead of creating another checkout', async () => {
    vi.useFakeTimers();
    try {
      gateway.complete.mockRejectedValue(new SelfCheckoutGatewayError('network-error', true, true));
      gateway.status.mockResolvedValue(completed);
      await render();

      const completion = callbacks.onApprove();
      await vi.advanceTimersByTimeAsync(350);
      await completion;

      expect(gateway.status).toHaveBeenCalledWith('checkout-1', 'capability-1');
      expect(gateway.create).toHaveBeenCalledOnce();
      expect(pos.finalizeServerCheckout).toHaveBeenCalledWith(completed.receipt, 4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('preserves the cart and attempt on cancellation', async () => {
    const fixture = await render();
    callbacks.onCancel();
    fixture.detectChanges();

    expect(pos.finalizeServerCheckout).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('capy_pos_self_checkout_attempt')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Nothing was removed from your basket');
  });

  it('invalidates payment when the cart revision changed, even if contents match', async () => {
    const fixture = await render();
    revision.set(6);
    fixture.nativeElement.querySelector('[data-testid="self-checkout-payment-paypal"]').click();
    fixture.detectChanges();

    expect(paypal.start).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('basket changed');
  });

  it('invalidates payment when a recreated cart reuses the same revision for different items', async () => {
    storeAttempt(4);
    pos.cartItems.set([{ product: { id: 'product-2', name: 'Tea', price: 0.01 }, quantity: 2 }]);
    gateway.status.mockResolvedValue({
      ...completed,
      state: SelfCheckoutState.AWAITING_APPROVAL,
      receipt: null,
    });

    const fixture = await render();

    expect(gateway.complete).not.toHaveBeenCalled();
    expect(paypal.initialize).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('create a new checkout');
  });

  it('status-checks a persisted attempt before offering another payment', async () => {
    storeAttempt();
    gateway.status.mockResolvedValue(completed);

    const fixture = await render();

    expect(gateway.status).toHaveBeenCalledWith('checkout-1', 'capability-1');
    expect(gateway.create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-receipt')).not.toBeNull();
  });

  it('keeps recovery state when destroyed before a completed status resolves', async () => {
    storeAttempt();
    let resolve!: (value: typeof completed) => void;
    gateway.status.mockReturnValue(
      new Promise((next) => {
        resolve = next;
      })
    );
    const fixture = TestBed.createComponent(SelfCheckoutPayComponent);
    fixture.detectChanges();
    await vi.waitFor(() => expect(gateway.status).toHaveBeenCalledOnce());

    fixture.destroy();
    resolve(completed);
    await Promise.resolve();

    expect(pos.finalizeServerCheckout).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('capy_pos_self_checkout_attempt')).not.toBeNull();
  });

  it('reissues idempotent server completion when reload finds an awaiting-approval attempt', async () => {
    storeAttempt();
    gateway.status.mockResolvedValue({
      ...completed,
      state: SelfCheckoutState.AWAITING_APPROVAL,
      receipt: null,
    });
    gateway.complete.mockResolvedValue(completed);

    const fixture = await render();

    expect(gateway.complete).toHaveBeenCalledWith('checkout-1', 'capability-1');
    expect(paypal.initialize).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-receipt')).not.toBeNull();
  });

  it('blocks a second order for manual review states', async () => {
    storeAttempt();
    gateway.status.mockResolvedValue({
      ...completed,
      state: SelfCheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
      receipt: null,
    });

    const fixture = await render();

    expect(gateway.create).not.toHaveBeenCalled();
    expect(paypal.start).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Do not try to pay a second time');
  });

  it('does not present an old manual-review quote as the changed basket', async () => {
    const muffinAttempt = {
      ...created,
      quote: {
        ...quote,
        lines: [
          {
            ...quote.lines[0],
            productId: 'product-5',
            productName: 'Muffin',
            quantity: 1,
            unitPriceMinorUnits: 250,
            subtotalMinorUnits: 250,
          },
        ],
        subtotalMinorUnits: 250,
        taxMinorUnits: 21,
        totalMinorUnits: 271,
      },
    };
    storeAttempt(4, muffinAttempt, [{ productId: 'product-5', quantity: 1 }]);
    pos.cartItems.set([{ product: { id: 'product-1', name: 'Coffee', price: 2.5 }, quantity: 1 }]);
    gateway.status.mockResolvedValue({
      ...completed,
      quote: muffinAttempt.quote,
      state: SelfCheckoutState.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
      receipt: null,
    });

    const fixture = await render();

    expect(gateway.create).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Do not try to pay a second time');
    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-server-quote"]')
    ).toBeNull();
  });

  it('allows an explicit local-only reset of a manual-review attempt', async () => {
    const muffinAttempt = {
      ...created,
      quote: {
        ...quote,
        lines: [
          {
            ...quote.lines[0],
            productId: 'product-5',
            productName: 'Muffin',
            quantity: 1,
            unitPriceMinorUnits: 250,
            subtotalMinorUnits: 250,
          },
        ],
        subtotalMinorUnits: 250,
        taxMinorUnits: 21,
        totalMinorUnits: 271,
      },
    };
    storeAttempt(4, muffinAttempt, [{ productId: 'product-5', quantity: 1 }]);
    pos.cartItems.set([{ product: { id: 'product-1', name: 'Coffee', price: 2.5 }, quantity: 1 }]);
    gateway.status.mockResolvedValue({
      ...completed,
      quote: muffinAttempt.quote,
      state: SelfCheckoutState.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
      receipt: null,
    });

    const fixture = await render();
    fixture.nativeElement
      .querySelector('[data-testid="self-checkout-discard-local-attempt"]')
      .click();

    expect(sessionStorage.getItem('capy_pos_self_checkout_attempt')).toBeNull();
    expect(navigate).toHaveBeenCalledWith([LANE_ROUTE]);

    fixture.destroy();
    gateway.status.mockReset();
    gateway.create.mockClear();
    gateway.create.mockResolvedValue({
      ...created,
      checkoutId: 'checkout-2',
      paypalOrderId: 'order-2',
      checkoutToken: 'capability-2',
    });
    const replacement = await render();

    expect(gateway.status).not.toHaveBeenCalled();
    expect(gateway.create).toHaveBeenCalledWith(
      [{ productId: 'product-1', quantity: 1 }],
      expect.not.stringMatching('idempotency-1')
    );
    expect(replacement.nativeElement.textContent).toContain('Coffee');
    expect(replacement.nativeElement.textContent).not.toContain('Muffin');
  });

  it('replaces an attempt missing after a local in-memory server restart', async () => {
    storeAttempt(4, {
      ...created,
      quote: {
        ...quote,
        lines: [{ ...quote.lines[0], productName: 'Muffin' }],
      },
    });
    pos.cartItems.set([{ product: { id: 'product-2', name: 'Coffee', price: 2.5 }, quantity: 1 }]);
    gateway.status.mockRejectedValue(new SelfCheckoutGatewayError('not-found', false, false, 404));
    gateway.create.mockResolvedValue({
      ...created,
      checkoutId: 'checkout-2',
      paypalOrderId: 'order-2',
      checkoutToken: 'capability-2',
      quote: {
        ...quote,
        lines: [
          {
            ...quote.lines[0],
            productId: 'product-2',
            productName: 'Coffee',
            quantity: 1,
            unitPriceMinorUnits: 250,
            subtotalMinorUnits: 250,
          },
        ],
        subtotalMinorUnits: 250,
        taxMinorUnits: 21,
        totalMinorUnits: 271,
      },
    });

    const fixture = await render();

    expect(gateway.status).toHaveBeenCalledWith('checkout-1', 'capability-1');
    expect(gateway.create).toHaveBeenCalledWith(
      [{ productId: 'product-2', quantity: 1 }],
      expect.not.stringMatching('idempotency-1')
    );
    expect(fixture.nativeElement.textContent).toContain('Coffee');
    expect(fixture.nativeElement.textContent).not.toContain('Muffin');
  });

  it('recovers a completed attempt before requiring PayPal availability', async () => {
    storeAttempt();
    gateway.status.mockResolvedValue(completed);
    paypal.initialize.mockResolvedValue(false);

    const fixture = await render();

    expect(gateway.status).toHaveBeenCalledWith('checkout-1', 'capability-1');
    expect(paypal.initialize).not.toHaveBeenCalled();
    expect(fixture.nativeElement.querySelector('app-receipt')).not.toBeNull();
  });

  it('renders the authoritative completed receipt after a full reload', async () => {
    storeAttempt(4);
    revision.set(0);
    pos.cartItems.set([]);
    gateway.status.mockResolvedValue(completed);
    pos.finalizeServerCheckout.mockImplementation(() => {
      throw new CartChangedDuringCheckoutError();
    });

    const fixture = await render();

    expect(pos.serverCheckoutReceiptData).toHaveBeenCalledWith(completed.receipt);
    expect(fixture.nativeElement.querySelector('app-receipt')).not.toBeNull();
    expect(sessionStorage.getItem('capy_pos_self_checkout_attempt')).toBeNull();
  });

  it('invalidates an approval-only checkout after the basket changes', async () => {
    storeAttempt(4);
    revision.set(6);
    gateway.status.mockResolvedValue({
      ...completed,
      state: SelfCheckoutState.AWAITING_APPROVAL,
      receipt: null,
    });

    const fixture = await render();

    expect(gateway.status).toHaveBeenCalledOnce();
    expect(gateway.create).not.toHaveBeenCalled();
    expect(paypal.initialize).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('capy_pos_self_checkout_attempt')).toBeNull();
    expect(fixture.nativeElement.textContent).toContain('create a new checkout');
  });

  it('replaces an expired checkout for the changed basket', async () => {
    storeAttempt(4);
    revision.set(6);
    gateway.status.mockResolvedValue({
      ...completed,
      state: SelfCheckoutState.EXPIRED,
      receipt: null,
    });

    await render();

    expect(gateway.status).toHaveBeenCalledOnce();
    expect(gateway.create).toHaveBeenCalledWith(
      [{ productId: 'product-1', quantity: 2 }],
      expect.not.stringMatching('idempotency-1')
    );
  });

  it('never creates a replacement while capture may still be possible', async () => {
    storeAttempt(4);
    revision.set(6);
    gateway.status.mockResolvedValue({
      ...completed,
      state: SelfCheckoutState.CAPTURE_REQUESTED,
      receipt: null,
    });

    const fixture = await render();

    expect(gateway.create).not.toHaveBeenCalled();
    expect(paypal.initialize).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('capy_pos_self_checkout_attempt')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('may still be processing');
    expect(
      fixture.nativeElement.querySelector('[data-testid="self-checkout-server-quote"]')
    ).toBeNull();
  });

  it('returns to the same route-scoped basket', async () => {
    const fixture = await render();
    fixture.nativeElement.querySelector('[data-testid="self-checkout-payment-back"]').click();
    expect(navigate).toHaveBeenCalledWith([LANE_ROUTE]);
  });

  it('does not navigate away while server completion is in progress', async () => {
    let resolve!: (value: typeof completed) => void;
    gateway.complete.mockReturnValue(
      new Promise((next) => {
        resolve = next;
      })
    );
    const fixture = await render();
    const completion = callbacks.onApprove();
    fixture.detectChanges();

    const back = fixture.nativeElement.querySelector(
      '[data-testid="self-checkout-payment-back"]'
    ) as HTMLButtonElement;
    expect(back.disabled).toBe(true);
    back.click();
    expect(navigate).not.toHaveBeenCalled();

    resolve(completed);
    await completion;
  });
});
