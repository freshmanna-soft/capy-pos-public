import { InjectionToken } from '@angular/core';

/**
 * Result returned to the checkout component after the MercadoPago brick
 * has completed a payment (approved, pending, or rejected).
 */
export interface MercadoPagoPaymentResult {
  status: 'approved' | 'pending' | 'rejected';
  paymentId: string;
  preferenceId: string;
  amount: number;
  timestamp: Date;
}

/**
 * MercadoPago payment port — application-layer abstraction.
 *
 * Implementations (real SDK adapter or test stub) are registered via
 * `MERCADOPAGO_PAYMENT_PORT` so the checkout use-case and component never
 * import the infrastructure class directly.
 */
export interface MercadoPagoPort {
  /**
   * Returns true when the MercadoPago feature flag is enabled for this build.
   * The checkout component shows the "MercadoPago" button only when this is true.
   */
  isEnabled(): boolean;

  /**
   * Loads the MercadoPago JS SDK into the page (idempotent — safe to call more
   * than once; the script tag is injected only on the first call).
   */
  loadSdk(): Promise<void>;

  /**
   * Creates a payment preference via the operator backend, mounts the
   * MercadoPago Payment Brick inside the given DOM container element, and
   * resolves with the payment result once the buyer completes or cancels.
   *
   * @param amount   Amount to charge (read from the cart total).
   * @param containerId  `id` of the DOM element where the Brick will render.
   */
  createAndRender(amount: number, containerId: string): Promise<MercadoPagoPaymentResult>;

  /**
   * Unmounts the active Brick and cleans up internal state.
   * Should be called when the checkout overlay is closed.
   */
  destroy(): void;
}

/** DI token for the MercadoPago payment port. */
export const MERCADOPAGO_PAYMENT_PORT = new InjectionToken<MercadoPagoPort>('MercadoPagoPort');
