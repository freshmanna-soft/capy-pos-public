export const CheckoutState = {
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

export type CheckoutState = (typeof CheckoutState)[keyof typeof CheckoutState];

const S = CheckoutState;

/**
 * Every recovery state retains the highest irreversible provider fact reached.
 * In particular, an authorization or possible capture can never regress to an
 * ordinary expiry/void path.
 */
export const LEGAL_CHECKOUT_TRANSITIONS: Readonly<Record<CheckoutState, readonly CheckoutState[]>> =
  Object.freeze({
    [S.CREATING]: Object.freeze([S.CREATE_ORDER_REQUESTED, S.EXPIRED]),
    [S.CREATE_ORDER_REQUESTED]: Object.freeze([
      S.AWAITING_APPROVAL,
      S.RECONCILE_CREATE_ORDER_UNKNOWN,
      S.MANUAL_REVIEW_CREATE_UNKNOWN,
    ]),
    [S.RECONCILE_CREATE_ORDER_UNKNOWN]: Object.freeze([
      S.AWAITING_APPROVAL,
      S.EXPIRED,
      S.MANUAL_REVIEW_CREATE_UNKNOWN,
    ]),
    [S.AWAITING_APPROVAL]: Object.freeze([
      S.AUTHORIZE_REQUESTED,
      S.EXPIRED,
      S.MANUAL_REVIEW_AWAITING_APPROVAL,
    ]),
    [S.AUTHORIZE_REQUESTED]: Object.freeze([
      S.AUTHORIZED,
      S.RECONCILE_AUTHORIZE_UNKNOWN,
      S.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
    ]),
    [S.RECONCILE_AUTHORIZE_UNKNOWN]: Object.freeze([
      S.AUTHORIZE_REQUESTED,
      S.AUTHORIZED,
      S.EXPIRED,
      S.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
    ]),
    [S.AUTHORIZED]: Object.freeze([
      S.RESERVING,
      S.NEVER_CAPTURE_VOID_REQUESTED,
      S.MANUAL_REVIEW_AUTHORIZED,
    ]),
    [S.RESERVING]: Object.freeze([
      S.RESERVED,
      S.NEVER_CAPTURE_VOID_REQUESTED,
      S.MANUAL_REVIEW_AUTHORIZED,
    ]),
    [S.RESERVED]: Object.freeze([
      S.CAPTURE_REQUESTED,
      S.NEVER_CAPTURE_VOID_REQUESTED,
      S.MANUAL_REVIEW_AUTHORIZED,
    ]),
    [S.NEVER_CAPTURE_VOID_REQUESTED]: Object.freeze([
      S.CONFIRMED_NON_CAPTURABLE,
      S.RECONCILE_VOID_UNKNOWN,
      S.MANUAL_REVIEW_AUTHORIZED,
    ]),
    [S.RECONCILE_VOID_UNKNOWN]: Object.freeze([
      S.CONFIRMED_NON_CAPTURABLE,
      S.MANUAL_REVIEW_AUTHORIZED,
    ]),
    [S.CAPTURE_REQUESTED]: Object.freeze([
      S.CAPTURED_PENDING_COMMIT,
      S.RECONCILE_CAPTURE_UNKNOWN,
      S.MANUAL_REVIEW_CAPTURE_UNKNOWN,
    ]),
    [S.RECONCILE_CAPTURE_UNKNOWN]: Object.freeze([
      S.CAPTURED_PENDING_COMMIT,
      S.CONFIRMED_NON_CAPTURABLE,
      S.MANUAL_REVIEW_CAPTURE_UNKNOWN,
    ]),
    [S.CONFIRMED_NON_CAPTURABLE]: Object.freeze([S.VOIDED, S.MANUAL_REVIEW_AUTHORIZED]),
    [S.CAPTURED_PENDING_COMMIT]: Object.freeze([
      S.COMMITTING,
      S.RECONCILE_CAPTURED,
      S.MANUAL_REVIEW_CAPTURED,
    ]),
    [S.COMMITTING]: Object.freeze([S.COMPLETED, S.RECONCILE_CAPTURED, S.MANUAL_REVIEW_CAPTURED]),
    [S.RECONCILE_CAPTURED]: Object.freeze([S.COMMITTING, S.COMPLETED, S.MANUAL_REVIEW_CAPTURED]),
    [S.COMPLETED]: Object.freeze([]),
    [S.VOIDED]: Object.freeze([]),
    [S.EXPIRED]: Object.freeze([]),
    [S.MANUAL_REVIEW_CREATE_UNKNOWN]: Object.freeze([]),
    [S.MANUAL_REVIEW_AWAITING_APPROVAL]: Object.freeze([]),
    [S.MANUAL_REVIEW_AUTHORIZE_UNKNOWN]: Object.freeze([]),
    [S.MANUAL_REVIEW_AUTHORIZED]: Object.freeze([]),
    [S.MANUAL_REVIEW_CAPTURE_UNKNOWN]: Object.freeze([]),
    [S.MANUAL_REVIEW_CAPTURED]: Object.freeze([]),
  });

const STATE_VALUES: ReadonlySet<string> = new Set(Object.values(CheckoutState));
const TERMINAL_STATES: ReadonlySet<CheckoutState> = new Set([
  S.COMPLETED,
  S.VOIDED,
  S.EXPIRED,
  S.MANUAL_REVIEW_CREATE_UNKNOWN,
  S.MANUAL_REVIEW_AWAITING_APPROVAL,
  S.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
  S.MANUAL_REVIEW_AUTHORIZED,
  S.MANUAL_REVIEW_CAPTURE_UNKNOWN,
  S.MANUAL_REVIEW_CAPTURED,
]);
const CAPTURE_MAY_HAVE_SUCCEEDED: ReadonlySet<CheckoutState> = new Set([
  S.CAPTURE_REQUESTED,
  S.RECONCILE_CAPTURE_UNKNOWN,
  S.CAPTURED_PENDING_COMMIT,
  S.COMMITTING,
  S.RECONCILE_CAPTURED,
  S.COMPLETED,
  S.MANUAL_REVIEW_CAPTURE_UNKNOWN,
  S.MANUAL_REVIEW_CAPTURED,
]);

export function isCheckoutState(value: unknown): value is CheckoutState {
  return typeof value === 'string' && STATE_VALUES.has(value);
}

export function canTransitionCheckout(from: unknown, to: unknown): boolean {
  return (
    isCheckoutState(from) && isCheckoutState(to) && LEGAL_CHECKOUT_TRANSITIONS[from].includes(to)
  );
}

export function assertCheckoutTransition(from: unknown, to: unknown): void {
  if (!canTransitionCheckout(from, to)) {
    throw new Error(`Illegal checkout transition: ${String(from)} -> ${String(to)}.`);
  }
}

export function isTerminalCheckoutState(state: unknown): state is CheckoutState {
  return isCheckoutState(state) && TERMINAL_STATES.has(state);
}

/** Unknown/corrupt state is treated as capture-possible so callers fail closed. */
export function captureMayHaveSucceeded(state: unknown): boolean {
  return !isCheckoutState(state) || CAPTURE_MAY_HAVE_SUCCEEDED.has(state);
}
