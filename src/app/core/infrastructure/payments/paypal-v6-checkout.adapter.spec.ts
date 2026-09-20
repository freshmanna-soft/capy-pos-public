import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { PayPalCheckoutCallbacks } from '@core/application/ports/paypal-checkout.port';
import { PAYPAL_BROWSER_CONFIG } from './paypal-config';

const paypalMocks = vi.hoisted(() => ({
  loadCoreSdkScript: vi.fn(),
}));

vi.mock('@paypal/paypal-js/sdk-v6', () => ({
  loadCoreSdkScript: paypalMocks.loadCoreSdkScript,
}));

import { PayPalV6CheckoutAdapter } from './paypal-v6-checkout.adapter';

describe('PayPalV6CheckoutAdapter', () => {
  const callbacks: PayPalCheckoutCallbacks = {
    onApprove: vi.fn().mockResolvedValue(undefined),
    onCancel: vi.fn(),
    onError: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
    TestBed.configureTestingModule({
      providers: [
        PayPalV6CheckoutAdapter,
        {
          provide: PAYPAL_BROWSER_CONFIG,
          useValue: { enabled: true, clientId: 'public-client-id', environment: 'sandbox' },
        },
      ],
    });
  });

  it('loads V6 with public browser configuration and checks eligibility', async () => {
    const findEligibleMethods = vi.fn().mockResolvedValue({ isEligible: () => true });
    const createInstance = vi.fn().mockResolvedValue({ findEligibleMethods });
    paypalMocks.loadCoreSdkScript.mockResolvedValue({ createInstance });

    await expect(TestBed.inject(PayPalV6CheckoutAdapter).initialize(callbacks)).resolves.toBe(true);

    expect(paypalMocks.loadCoreSdkScript).toHaveBeenCalledWith({ environment: 'sandbox' });
    expect(createInstance).toHaveBeenCalledWith({
      clientId: 'public-client-id',
      components: ['paypal-payments'],
      pageType: 'checkout',
    });
  });

  it('starts one-time payment with the server order id', async () => {
    const start = vi.fn().mockResolvedValue(undefined);
    const createPayPalOneTimePaymentSession = vi.fn().mockReturnValue({ start, destroy: vi.fn() });
    paypalMocks.loadCoreSdkScript.mockResolvedValue({
      createInstance: vi.fn().mockResolvedValue({
        findEligibleMethods: vi.fn().mockResolvedValue({ isEligible: () => true }),
        createPayPalOneTimePaymentSession,
      }),
    });
    const adapter = TestBed.inject(PayPalV6CheckoutAdapter);
    await adapter.initialize(callbacks);

    await adapter.start('order-1');

    expect(createPayPalOneTimePaymentSession).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: 'order-1', commit: true })
    );
    expect(start).toHaveBeenCalledWith({ presentationMode: 'auto' });
  });

  it('rejects approval for a different PayPal order', async () => {
    let onApprove!: (data: { orderId: string }) => Promise<void>;
    paypalMocks.loadCoreSdkScript.mockResolvedValue({
      createInstance: vi.fn().mockResolvedValue({
        findEligibleMethods: vi.fn().mockResolvedValue({ isEligible: () => true }),
        createPayPalOneTimePaymentSession: vi.fn().mockImplementation((config) => {
          onApprove = config.onApprove;
          return { start: vi.fn(), destroy: vi.fn() };
        }),
      }),
    });
    const adapter = TestBed.inject(PayPalV6CheckoutAdapter);
    await adapter.initialize(callbacks);
    await adapter.start('order-1');

    await onApprove({ orderId: 'other-order' });

    expect(callbacks.onApprove).not.toHaveBeenCalled();
    expect(callbacks.onError).toHaveBeenCalledWith('paypal-order-mismatch', false);
  });

  it('resumes only when the V6 session reports a redirect return', async () => {
    const resume = vi.fn().mockResolvedValue(undefined);
    paypalMocks.loadCoreSdkScript.mockResolvedValue({
      createInstance: vi.fn().mockResolvedValue({
        findEligibleMethods: vi.fn().mockResolvedValue({ isEligible: () => true }),
        createPayPalOneTimePaymentSession: vi.fn().mockReturnValue({
          hasReturned: () => true,
          resume,
          destroy: vi.fn(),
        }),
      }),
    });
    const adapter = TestBed.inject(PayPalV6CheckoutAdapter);
    await adapter.initialize(callbacks);

    await expect(adapter.resumeIfReturned('order-1')).resolves.toBe(true);
    expect(resume).toHaveBeenCalledOnce();
  });
});
