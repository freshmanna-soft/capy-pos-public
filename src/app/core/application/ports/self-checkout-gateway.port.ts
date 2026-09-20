import { InjectionToken } from '@angular/core';

export interface SelfCheckoutItemRequest {
  readonly productId: string;
  readonly quantity: number;
}

export interface SelfCheckoutLineSnapshot {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPriceMinorUnits: number;
  readonly subtotalMinorUnits: number;
}

export interface SelfCheckoutQuote {
  readonly currency: 'USD';
  readonly taxRateBasisPoints: number;
  readonly lines: readonly SelfCheckoutLineSnapshot[];
  readonly subtotalMinorUnits: number;
  readonly taxMinorUnits: number;
  readonly totalMinorUnits: number;
}

export interface CreatedSelfCheckout {
  readonly checkoutId: string;
  readonly paypalOrderId: string;
  readonly checkoutToken: string;
  readonly state: 'awaiting-approval';
  readonly quote: SelfCheckoutQuote;
}

export const SelfCheckoutState = {
  CREATING: 'creating',
  CREATE_ORDER_REQUESTED: 'create-order-requested',
  RECONCILE_CREATE_ORDER_UNKNOWN: 'reconcile-create-order-unknown',
  AWAITING_APPROVAL: 'awaiting-approval',
  AUTHORIZE_REQUESTED: 'authorize-requested',
  RECONCILE_AUTHORIZE_UNKNOWN: 'reconcile-authorize-unknown',
  AUTHORIZED: 'authorized',
  RESERVING: 'reserving',
  RESERVED: 'reserved',
  NEVER_CAPTURE_VOID_REQUESTED: 'never-capture-void-requested',
  RECONCILE_VOID_UNKNOWN: 'reconcile-void-unknown',
  CAPTURE_REQUESTED: 'capture-requested',
  RECONCILE_CAPTURE_UNKNOWN: 'reconcile-capture-unknown',
  CONFIRMED_NON_CAPTURABLE: 'confirmed-non-capturable',
  CAPTURED_PENDING_COMMIT: 'captured-pending-commit',
  COMMITTING: 'committing',
  RECONCILE_CAPTURED: 'reconcile-captured',
  COMPLETED: 'completed',
  VOIDED: 'voided',
  EXPIRED: 'expired',
  MANUAL_REVIEW_CREATE_UNKNOWN: 'manual-review-create-unknown',
  MANUAL_REVIEW_AWAITING_APPROVAL: 'manual-review-awaiting-approval',
  MANUAL_REVIEW_AUTHORIZE_UNKNOWN: 'manual-review-authorize-unknown',
  MANUAL_REVIEW_AUTHORIZED: 'manual-review-authorized',
  MANUAL_REVIEW_CAPTURE_UNKNOWN: 'manual-review-capture-unknown',
  MANUAL_REVIEW_CAPTURED: 'manual-review-captured',
} as const;

export type SelfCheckoutState = (typeof SelfCheckoutState)[keyof typeof SelfCheckoutState];

export interface SelfCheckoutReceipt {
  readonly transactionId: string;
  readonly checkoutId: string;
  readonly quote: SelfCheckoutQuote;
  readonly paypalCaptureId: string;
  readonly completedAt: string;
}

export interface SelfCheckoutStatus {
  readonly checkoutId: string;
  readonly state: SelfCheckoutState;
  readonly quote: SelfCheckoutQuote;
  readonly paypalOrderId: string | null;
  readonly receipt: SelfCheckoutReceipt | null;
  readonly failure: Readonly<{ code: string; retryable: boolean }> | null;
}

export interface SelfCheckoutGateway {
  create(
    items: readonly SelfCheckoutItemRequest[],
    idempotencyKey: string
  ): Promise<CreatedSelfCheckout>;
  status(checkoutId: string, checkoutToken: string): Promise<SelfCheckoutStatus>;
  complete(checkoutId: string, checkoutToken: string): Promise<SelfCheckoutStatus>;
}

export class SelfCheckoutGatewayError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
    readonly ambiguous: boolean,
    readonly status?: number
  ) {
    super(`Self-checkout request failed: ${code}.`);
    this.name = 'SelfCheckoutGatewayError';
  }
}

export const SELF_CHECKOUT_GATEWAY = new InjectionToken<SelfCheckoutGateway>(
  'SELF_CHECKOUT_GATEWAY'
);
