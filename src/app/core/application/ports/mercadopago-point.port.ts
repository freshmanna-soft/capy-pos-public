import { InjectionToken } from '@angular/core';

/**
 * Smallest charge Mercado Pago accepts for a Point order. It rejects anything lower
 * with `'$.transactions.payments[0].amount' Must be greater than or equal to 5.00`
 * (seen on an MXN account; the server enforces the same value in `mp-point.ts`).
 */
export const POINT_MIN_AMOUNT = 5;

/** What the till asks a linked Mercado Pago Point card machine to charge. */
export interface PointChargeRequest {
  /** Amount to charge (the cart total). */
  amount: number;
  /**
   * The sale's `transactionId`. It becomes the order's `external_reference`, so
   * the same id ties together the MP order, the outbox row and the bus events.
   */
  externalReference: string;
  /** The Point device this terminal is linked to (checked server-side too). */
  terminalId: string;
}

/** Order statuses worth surfacing to the UI / event bus while a charge is open. */
export type PointOrderStatus = 'created' | 'at_terminal';

/**
 * How a Point charge ended.
 *
 *  - `approved` — the order reached `processed`. The only status that is a sale.
 *  - `rejected` — `failed`, `expired`, `refunded`, or the order could not be created.
 *  - `cancelled` — the charge was abandoned. Never a sale.
 *  - `needs-confirmation` — `action_required`, or a cancel the device never acted
 *    on within the cancel window: the outcome is unknown. The clerk must check the
 *    device before finalizing.
 */
export interface PointChargeResult {
  status: 'approved' | 'rejected' | 'cancelled' | 'needs-confirmation';
  /** MP order id; empty when the order was never created. */
  orderId: string;
  paymentId: string;
  amount: number;
  timestamp: Date;
  /**
   * Only on `cancelled`: false when the gateway could not confirm the cancel in
   * time. The sale is still not finalized, but the buyer may have been charged —
   * the UI should tell the clerk to check the device.
   */
  cancellationConfirmed?: boolean;
}

/**
 * Mercado Pago Point port — charges the cart total on a physical card machine.
 * Application-layer abstraction; the checkout never imports the adapter.
 */
export interface MercadoPagoPointPort {
  /**
   * Creates the order on the linked device and resolves once it is final.
   * Polling or network errors never settle the promise as a sale; it settles
   * `cancelled` (unconfirmed) when no final status arrives before the deadline.
   *
   * @param onStatus Fired when the order moves to `created` / `at_terminal`.
   */
  charge(
    request: PointChargeRequest,
    onStatus?: (status: PointOrderStatus) => void
  ): Promise<PointChargeResult>;

  /**
   * Cancels the in-flight charge. The pending `charge` promise settles exactly
   * once with the same result this returns: `cancelled`, or `approved` when the
   * buyer paid during the cancel window (MP answers 202 for an order already
   * `at_terminal`, so the final status arrives later). Idempotent; resolves
   * `cancelled` when nothing is in flight.
   */
  cancel(): Promise<PointChargeResult>;

  /** Stops polling and settles any pending charge as an unconfirmed `cancelled`. */
  destroy(): void;
}

/** DI token for the Mercado Pago Point port. */
export const MERCADOPAGO_POINT_PORT = new InjectionToken<MercadoPagoPointPort>(
  'MercadoPagoPointPort'
);
