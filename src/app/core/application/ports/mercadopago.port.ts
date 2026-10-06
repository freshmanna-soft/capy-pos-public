import { InjectionToken } from '@angular/core';

/**
 * Result returned to the checkout component after the MercadoPago brick
 * has completed a payment (approved, pending, or rejected).
 */
export interface MercadoPagoPaymentResult {
  /**
   * `cancelled` means the attempt was abandoned — by the buyer (our Cancel
   * button, or MP's own "Return to site" link) or by the till closing — and
   * the adapter asked the gateway to kill it. It is never a sale.
   */
  status: 'approved' | 'pending' | 'rejected' | 'cancelled';
  paymentId: string;
  preferenceId: string;
  amount: number;
  timestamp: Date;
  /**
   * Only on `cancelled`: false when the gateway could not confirm the cancel
   * (network / MP error). The sale is still not finalized, but the UI should
   * tell the customer to check with a cashier in case they were charged.
   */
  cancellationConfirmed?: boolean;
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
   * The buyer logs in to their MP account / scans a QR to pay; the promise
   * resolves when MP confirms the payment, or with `status: 'cancelled'` when
   * the attempt is cancelled (see `cancelPayment`).
   *
   * @param amount           Amount to charge.
   * @param containerId      `id` of the DOM element where the Wallet Brick will render.
   * @param onPollingStarted Fired when the buyer clicks Pay and polling begins —
   *                         switch the UI to "waiting for confirmation".
   * @param onCancelling     Fired when the adapter itself starts a gateway cancel
   *                         (the buyer came back from MP without paying, or the
   *                         wait timed out) — switch the UI to "cancelling".
   */
  createWalletBrick(
    amount: number,
    containerId: string,
    onPollingStarted?: () => void,
    onCancelling?: () => void
  ): Promise<MercadoPagoPaymentResult>;

  /**
   * Cancels the in-flight attempt (Card or Wallet) and makes it final at the
   * gateway: polling stops, the Brick unmounts, and for a wallet attempt the
   * backend cancels pending payments and expires the preference.
   *
   * The pending `createWalletBrick` / `createAndRender` promise settles exactly
   * once with the same result this returns: `cancelled`, or `approved` when
   * the gateway reports the buyer had already paid — then the sale must be
   * finalized, not dropped. Idempotent; resolves `cancelled` when nothing is
   * in flight.
   */
  cancelPayment(): Promise<MercadoPagoPaymentResult>;

  /**
   * Unmounts any active Brick (Card or Wallet), stops polling, and settles any
   * pending attempt as `cancelled` so no late result can finalize a sale.
   * A wallet preference that was created is also cancelled at the gateway,
   * best-effort. Call it when the checkout overlay is closed.
   */
  destroy(): void;
}

/** DI token for the MercadoPago payment port. */
export const MERCADOPAGO_PAYMENT_PORT = new InjectionToken<MercadoPagoPort>('MercadoPagoPort');

/**
 * BroadcastChannel the MP return tab (`PaymentCallbackComponent`) uses to tell
 * the waiting checkout tab how the buyer left MercadoPago's checkout.
 */
export const MP_PAYMENT_RESULT_CHANNEL = 'mp-payment-result';

/**
 * How the buyer left MP's checkout, as far as the return URL can tell.
 * `abandoned` covers every non-approved return — MP's "Return to site" link
 * (status `null`), a failure, or a pending ticket nobody will pay at a till —
 * and makes the checkout cancel the attempt at the gateway.
 */
export const MercadoPagoReturnOutcome = {
  APPROVED: 'approved',
  ABANDONED: 'abandoned',
} as const;
export type MercadoPagoReturnOutcome =
  (typeof MercadoPagoReturnOutcome)[keyof typeof MercadoPagoReturnOutcome];

/** Payload posted on `MP_PAYMENT_RESULT_CHANNEL`. */
export interface MercadoPagoReturnMessage {
  outcome: MercadoPagoReturnOutcome;
  /** The raw `status` / `collection_status` MP appended (may be `'null'`). */
  status: string;
  paymentId: string;
  preferenceId: string;
  /** Lets a checkout ignore a return that belongs to another tab's attempt. */
  externalReference: string;
}
