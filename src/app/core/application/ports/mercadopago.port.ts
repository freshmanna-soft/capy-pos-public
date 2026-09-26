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
 * Two payment modes are supported:
 *
 *  - **Card Brick** (`createAndRender`) — the buyer types card details into the
 *    MP iframe. The adapter POSTs the card token to the backend which charges it.
 *
 *  - **Wallet Brick** (`createWalletBrick`) — the buyer pays from their existing
 *    MercadoPago account (the primary payment method in Latin America). The backend
 *    creates a Preference; the Brick shows a QR / link the buyer completes in the
 *    MP app. This is the recommended mode for point-of-sale.
 *
 * Implementations are registered via `MERCADOPAGO_PAYMENT_PORT` so the checkout
 * component never imports the infrastructure class directly.
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
   * **Card Brick mode.** The adapter POSTs `{ mode: 'card', formData, amount }`
   * to the backend, which charges the card token. Resolves when the buyer
   * completes or rejects.
   *
   * @param amount      Amount to charge (read from the cart total).
   * @param containerId `id` of the DOM element where the Brick will render.
   */
  createAndRender(amount: number, containerId: string): Promise<MercadoPagoPaymentResult>;

  /**
   * **Wallet Brick mode.** Asks the backend to create a MercadoPago Preference
   * (`mode: 'wallet'`), then mounts the Wallet Brick inside `containerId`.
   * The buyer logs in to their MP account / scans a QR to pay; the Brick
   * resolves when MP confirms the payment.
   *
   * @param amount      Amount to charge.
   * @param containerId `id` of the DOM element where the Wallet Brick will render.
   */
  /**
   * Optional callback fired when the buyer clicks Pay and polling begins.
   * Use it to switch the UI to a "waiting for confirmation" state.
   */
  createWalletBrick(
    amount: number,
    containerId: string,
    onPollingStarted?: () => void
  ): Promise<MercadoPagoPaymentResult>;

  /**
   * Unmounts any active Brick (Card or Wallet) and cleans up internal state.
   * Should be called when the checkout overlay is closed.
   */
  destroy(): void;
}

/** DI token for the MercadoPago payment port. */
export const MERCADOPAGO_PAYMENT_PORT = new InjectionToken<MercadoPagoPort>('MercadoPagoPort');
