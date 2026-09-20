import { Injectable, inject } from '@angular/core';
import { loadCoreSdkScript } from '@paypal/paypal-js/sdk-v6';
import type {
  OneTimePaymentSession,
  PayPalV6Namespace,
  SdkInstance,
} from '@paypal/paypal-js/sdk-v6';
import {
  PayPalCheckout,
  PayPalCheckoutCallbacks,
} from '@core/application/ports/paypal-checkout.port';
import { PAYPAL_BROWSER_CONFIG } from './paypal-config';

@Injectable()
export class PayPalV6CheckoutAdapter implements PayPalCheckout {
  private readonly config = inject(PAYPAL_BROWSER_CONFIG);
  private sdk: SdkInstance<readonly ['paypal-payments']> | null = null;
  private callbacks: PayPalCheckoutCallbacks | null = null;
  private session: OneTimePaymentSession | null = null;

  async initialize(callbacks: PayPalCheckoutCallbacks): Promise<boolean> {
    this.callbacks = callbacks;
    if (!this.config.enabled || this.config.clientId.trim().length === 0) return false;

    const namespace: PayPalV6Namespace | null = await loadCoreSdkScript({
      environment: this.config.environment,
    });
    if (namespace === null) return false;

    this.sdk = await namespace.createInstance({
      clientId: this.config.clientId,
      components: ['paypal-payments'] as const,
      pageType: 'checkout',
    });
    const eligible = await this.sdk.findEligibleMethods();
    return eligible.isEligible('paypal');
  }

  async start(paypalOrderId: string): Promise<void> {
    const session = this.createSession(paypalOrderId);
    await session.start({ presentationMode: 'auto' });
  }

  async resumeIfReturned(paypalOrderId: string): Promise<boolean> {
    const session = this.createSession(paypalOrderId);
    if (session.hasReturned?.() !== true) return false;
    await session.resume?.();
    return true;
  }

  destroy(): void {
    this.session?.destroy();
    this.session = null;
  }

  private createSession(paypalOrderId: string): OneTimePaymentSession {
    if (this.sdk === null || this.callbacks === null) {
      throw new Error('PayPal checkout has not been initialized.');
    }
    this.destroy();
    const callbacks = this.callbacks;
    this.session = this.sdk.createPayPalOneTimePaymentSession({
      orderId: paypalOrderId,
      commit: true,
      onApprove: async (data) => {
        if (data.orderId !== paypalOrderId) {
          callbacks.onError('paypal-order-mismatch', false);
          return;
        }
        await callbacks.onApprove();
      },
      onCancel: () => callbacks.onCancel(),
      onError: (error) => callbacks.onError(error.code || 'paypal-error', error.isRecoverable),
    });
    return this.session;
  }
}
