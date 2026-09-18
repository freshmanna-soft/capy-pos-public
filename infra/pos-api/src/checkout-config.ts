import {
  MAX_CHECKOUT_AGGREGATE_QUANTITY,
  MAX_CHECKOUT_ITEM_QUANTITY,
  MAX_CHECKOUT_TOTAL_MINOR_UNITS,
  type CheckoutPricingPolicy,
} from './checkout-pricing.ts';

export interface CheckoutConfig extends CheckoutPricingPolicy {
  readonly storeId: string;
  readonly expectedPayPalMerchantId: string;
  readonly idempotencyKeyVersion: string;
  readonly capabilityKeyVersion: string;
  readonly paypalClientId: string;
  readonly paypalClientSecret: string;
  readonly paypalEnvironment: 'sandbox' | 'production';
  readonly paypalTimeoutMs: number;
}

export function loadCheckoutConfig(
  environment: Readonly<Record<string, string | undefined>>,
  mode: 'production' | 'development'
): CheckoutConfig {
  const defaults =
    mode === 'development'
      ? {
          currency: 'USD',
          taxBasisPoints: '850',
          maxItemQuantity: '10000',
          maxAggregateQuantity: '50000',
          maxTotalMinorUnits: '100000000',
        }
      : null;
  const currency = required(
    environment['CHECKOUT_CURRENCY'] ?? defaults?.currency,
    'CHECKOUT_CURRENCY'
  );
  if (currency !== 'USD') {
    throw new Error('CHECKOUT_CURRENCY must be USD.');
  }
  const taxBasisPoints = integer(
    environment['CHECKOUT_TAX_BASIS_POINTS'] ?? defaults?.taxBasisPoints,
    'CHECKOUT_TAX_BASIS_POINTS',
    0,
    10_000
  );
  const maxItemQuantity = integer(
    environment['CHECKOUT_MAX_ITEM_QUANTITY'] ?? defaults?.maxItemQuantity,
    'CHECKOUT_MAX_ITEM_QUANTITY',
    1,
    MAX_CHECKOUT_ITEM_QUANTITY
  );
  const maxAggregateQuantity = integer(
    environment['CHECKOUT_MAX_AGGREGATE_QUANTITY'] ?? defaults?.maxAggregateQuantity,
    'CHECKOUT_MAX_AGGREGATE_QUANTITY',
    1,
    MAX_CHECKOUT_AGGREGATE_QUANTITY
  );
  if (maxAggregateQuantity < maxItemQuantity) {
    throw new Error(
      'CHECKOUT_MAX_AGGREGATE_QUANTITY cannot be less than CHECKOUT_MAX_ITEM_QUANTITY.'
    );
  }

  return Object.freeze({
    currency,
    taxRateBasisPoints: taxBasisPoints,
    maxItemQuantity,
    maxAggregateQuantity,
    maxTotalMinorUnits: integer(
      environment['CHECKOUT_MAX_TOTAL_MINOR_UNITS'] ?? defaults?.maxTotalMinorUnits,
      'CHECKOUT_MAX_TOTAL_MINOR_UNITS',
      1,
      MAX_CHECKOUT_TOTAL_MINOR_UNITS
    ),
    storeId: required(environment['CHECKOUT_STORE_ID'], 'CHECKOUT_STORE_ID'),
    expectedPayPalMerchantId: required(
      environment['PAYPAL_EXPECTED_MERCHANT_ID'],
      'PAYPAL_EXPECTED_MERCHANT_ID'
    ),
    idempotencyKeyVersion: required(
      environment['CHECKOUT_IDEMPOTENCY_KEY_VERSION'],
      'CHECKOUT_IDEMPOTENCY_KEY_VERSION'
    ),
    capabilityKeyVersion: required(
      environment['CHECKOUT_CAPABILITY_KEY_VERSION'],
      'CHECKOUT_CAPABILITY_KEY_VERSION'
    ),
    paypalClientId: required(environment['PAYPAL_CLIENT_ID'], 'PAYPAL_CLIENT_ID'),
    paypalClientSecret: required(environment['PAYPAL_CLIENT_SECRET'], 'PAYPAL_CLIENT_SECRET'),
    paypalEnvironment: paypalEnvironment(environment['PAYPAL_ENVIRONMENT'], mode),
    paypalTimeoutMs: integer(
      environment['PAYPAL_TIMEOUT_MS'] ?? (mode === 'development' ? '10000' : undefined),
      'PAYPAL_TIMEOUT_MS',
      1,
      120_000
    ),
  });
}

function paypalEnvironment(
  value: string | undefined,
  mode: 'production' | 'development'
): 'sandbox' | 'production' {
  const selected = required(
    value ?? (mode === 'development' ? 'sandbox' : undefined),
    'PAYPAL_ENVIRONMENT'
  );
  if (selected !== 'sandbox' && selected !== 'production') {
    throw new Error('PAYPAL_ENVIRONMENT must be sandbox or production.');
  }
  if (mode === 'production' && selected !== 'production') {
    throw new Error('Production checkout requires PAYPAL_ENVIRONMENT=production.');
  }
  return selected;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

function integer(
  value: string | undefined,
  name: string,
  minimum: number,
  maximum: number
): number {
  const raw = required(value, name);
  if (!/^(0|[1-9]\d*)$/.test(raw)) {
    throw new Error(`${name} must be a base-10 integer.`);
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${name} is outside its allowed range.`);
  }
  return parsed;
}
