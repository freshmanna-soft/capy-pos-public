import { InjectionToken } from '@angular/core';

export interface PayPalCheckoutCallbacks {
  readonly onApprove: () => Promise<void>;
  readonly onCancel: () => void;
  readonly onError: (code: string, recoverable: boolean) => void;
}

/** Browser-payment seam that keeps PayPal SDK types in infrastructure. */
export interface PayPalCheckout {
  initialize(callbacks: PayPalCheckoutCallbacks): Promise<boolean>;
  start(paypalOrderId: string): Promise<void>;
  resumeIfReturned(paypalOrderId: string): Promise<boolean>;
  destroy(): void;
}

export const PAYPAL_CHECKOUT = new InjectionToken<PayPalCheckout>('PAYPAL_CHECKOUT');
