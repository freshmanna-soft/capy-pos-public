import {
  CreatedSelfCheckout,
  SelfCheckoutItemRequest,
  SelfCheckoutQuote,
  SelfCheckoutReceipt,
  SelfCheckoutState,
  SelfCheckoutStatus,
} from '@core/application/ports/self-checkout-gateway.port';

const SELF_CHECKOUT_STATES = new Set<string>(Object.values(SelfCheckoutState));

export function isCreatedSelfCheckout(value: unknown): value is CreatedSelfCheckout {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value['checkoutId']) &&
    isNonEmptyString(value['paypalOrderId']) &&
    isNonEmptyString(value['checkoutToken']) &&
    value['state'] === SelfCheckoutState.AWAITING_APPROVAL &&
    isSelfCheckoutQuote(value['quote'])
  );
}

export function isSelfCheckoutStatus(value: unknown): value is SelfCheckoutStatus {
  if (!isRecord(value)) return false;
  if (
    !isNonEmptyString(value['checkoutId']) ||
    !isSelfCheckoutState(value['state']) ||
    !isSelfCheckoutQuote(value['quote']) ||
    !(value['paypalOrderId'] === null || isNonEmptyString(value['paypalOrderId'])) ||
    !isFailure(value['failure'])
  ) {
    return false;
  }

  const receipt = value['receipt'];
  return (
    receipt === null ||
    (isSelfCheckoutReceipt(receipt) && receipt.checkoutId === value['checkoutId'])
  );
}

export function isSelfCheckoutQuote(value: unknown): value is SelfCheckoutQuote {
  if (!isRecord(value) || value['currency'] !== 'USD' || !Array.isArray(value['lines'])) {
    return false;
  }

  return (
    isBasisPoints(value['taxRateBasisPoints']) &&
    value['lines'].every(isQuoteLine) &&
    isMinorUnits(value['subtotalMinorUnits']) &&
    isMinorUnits(value['taxMinorUnits']) &&
    isMinorUnits(value['totalMinorUnits']) &&
    value['subtotalMinorUnits'] + value['taxMinorUnits'] === value['totalMinorUnits'] &&
    value['lines'].reduce((sum, line) => sum + line.subtotalMinorUnits, 0) ===
      value['subtotalMinorUnits']
  );
}

export function isSelfCheckoutItemRequest(value: unknown): value is SelfCheckoutItemRequest {
  if (!isRecord(value)) return false;
  return isNonEmptyString(value['productId']) && isPositiveInteger(value['quantity']);
}

function isSelfCheckoutReceipt(value: unknown): value is SelfCheckoutReceipt {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value['transactionId']) &&
    isNonEmptyString(value['checkoutId']) &&
    isSelfCheckoutQuote(value['quote']) &&
    isNonEmptyString(value['paypalCaptureId']) &&
    isIsoTimestamp(value['completedAt'])
  );
}

function isQuoteLine(value: unknown): value is SelfCheckoutQuote['lines'][number] {
  if (!isRecord(value)) return false;
  return (
    isNonEmptyString(value['productId']) &&
    isNonEmptyString(value['productName']) &&
    isPositiveInteger(value['quantity']) &&
    isMinorUnits(value['unitPriceMinorUnits']) &&
    isMinorUnits(value['subtotalMinorUnits']) &&
    value['unitPriceMinorUnits'] * value['quantity'] === value['subtotalMinorUnits']
  );
}

function isFailure(value: unknown): value is SelfCheckoutStatus['failure'] {
  return (
    value === null ||
    (isRecord(value) && isNonEmptyString(value['code']) && typeof value['retryable'] === 'boolean')
  );
}

function isSelfCheckoutState(value: unknown): value is SelfCheckoutState {
  return typeof value === 'string' && SELF_CHECKOUT_STATES.has(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMinorUnits(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function isPositiveInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isBasisPoints(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 10_000;
}

function isIsoTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length === 0) return false;
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
