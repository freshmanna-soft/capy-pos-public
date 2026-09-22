import { InjectionToken } from '@angular/core';

/**
 * Result returned to the checkout component after the PayPal Buttons
 * widget has completed a payment (completed, pending, or failed).
 */
export interface PayPalPaymentResult {
  status: 'completed' | 'pending' | 'failed';
  orderId: string;
  amount: number;
  timestamp: Date;
}

/**
 * PayPal payment port — application-layer abstraction.
 *
 * Implementations (real SDK adapter or test stub) are registered via
 * `PAYPAL_PAYMENT_PORT` so the checkout component never imports the
 * infrastructure class directly.
 */
export interface PayPalPort {
  /**
   * Returns true when the PayPal feature flag is enabled for this build.
   * The checkout component shows the "PayPal" button only when this is true.
   */
  isEnabled(): boolean;

  /**
   * Loads the PayPal JS SDK into the page (idempotent — safe to call more
   * than once; the script tag is injected only on the first call).
   */
  loadSdk(): Promise<void>;

  /**
   * Creates a PayPal order via the operator backend, renders the PayPal Buttons
   * widget inside the given DOM container element, and resolves with the
   * payment result once the buyer approves or the widget is closed.
   *
   * @param amount       Amount to charge (read from the cart total).
   * @param containerId  `id` of the DOM element where the Buttons will render.
   */
  createAndRender(amount: number, containerId: string): Promise<PayPalPaymentResult>;

  /**
   * Tears down the active PayPal Buttons widget and cleans up internal state.
   * Should be called when the checkout overlay is closed.
   */
  destroy(): void;
}

/** DI token for the PayPal payment port. */
export const PAYPAL_PAYMENT_PORT = new InjectionToken<PayPalPort>('PayPalPort');
