export const MAX_CHECKOUT_ITEMS = 50;
export const MAX_PRODUCT_ID_LENGTH = 200;
export const MAX_CHECKOUT_ITEM_QUANTITY = 10_000;
export const MAX_CHECKOUT_AGGREGATE_QUANTITY = 50_000;
export const MAX_CHECKOUT_TOTAL_MINOR_UNITS = 100_000_000;

export interface CheckoutItemRequest {
  readonly productId: string;
  readonly quantity: number;
}

export interface CheckoutCreateRequest {
  readonly items: readonly CheckoutItemRequest[];
}

export interface PricedProduct {
  readonly id: string;
  readonly name: string;
  /** Existing product major-unit price; converted once at this strict boundary. */
  readonly price: number;
  readonly isActive?: boolean;
}

export interface CheckoutLineSnapshot {
  readonly productId: string;
  readonly productName: string;
  readonly quantity: number;
  readonly unitPriceMinorUnits: number;
  readonly subtotalMinorUnits: number;
}

export interface CheckoutQuote {
  readonly currency: 'USD';
  readonly taxRateBasisPoints: number;
  readonly lines: readonly CheckoutLineSnapshot[];
  readonly subtotalMinorUnits: number;
  readonly taxMinorUnits: number;
  readonly totalMinorUnits: number;
}

export interface CheckoutPricingPolicy {
  readonly currency: 'USD';
  readonly taxRateBasisPoints: number;
  readonly maxItemQuantity: number;
  readonly maxAggregateQuantity: number;
  readonly maxTotalMinorUnits: number;
}

export class CheckoutValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CheckoutValidationError';
  }
}

export function parseCheckoutCreateRequest(
  value: unknown,
  limits: Pick<CheckoutPricingPolicy, 'maxItemQuantity' | 'maxAggregateQuantity'> = {
    maxItemQuantity: MAX_CHECKOUT_ITEM_QUANTITY,
    maxAggregateQuantity: MAX_CHECKOUT_AGGREGATE_QUANTITY,
  }
): CheckoutCreateRequest {
  assertPositiveLimit(limits.maxItemQuantity, 'maxItemQuantity');
  assertPositiveLimit(limits.maxAggregateQuantity, 'maxAggregateQuantity');
  const body = recordWithExactKeys(value, ['items'], 'Checkout request');
  if (
    !Array.isArray(body['items']) ||
    body['items'].length < 1 ||
    body['items'].length > MAX_CHECKOUT_ITEMS
  ) {
    throw new CheckoutValidationError(
      `items must contain 1 through ${MAX_CHECKOUT_ITEMS} entries.`
    );
  }

  const productIds = new Set<string>();
  let aggregate = 0n;
  const items = body['items'].map((raw, index) => {
    const item = recordWithExactKeys(raw, ['productId', 'quantity'], `items[${index}]`);
    const productId = item['productId'];
    const quantity = item['quantity'];
    assertProductId(productId, `items[${index}].productId`);
    if (productIds.has(productId)) {
      throw new CheckoutValidationError(`Duplicate product id: ${productId}.`);
    }
    if (
      !Number.isSafeInteger(quantity) ||
      (quantity as number) < 1 ||
      (quantity as number) > limits.maxItemQuantity
    ) {
      throw new CheckoutValidationError(`items[${index}].quantity is invalid.`);
    }
    aggregate += BigInt(quantity as number);
    if (aggregate > BigInt(limits.maxAggregateQuantity)) {
      throw new CheckoutValidationError('Aggregate quantity exceeds the checkout limit.');
    }
    productIds.add(productId);
    return Object.freeze({ productId, quantity: quantity as number });
  });

  return Object.freeze({ items: Object.freeze(items) });
}

/** Converts a finite, non-negative JavaScript major-unit number at an exact-cent boundary. */
export function majorUnitsToMinorUnits(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new CheckoutValidationError('Product price must be finite and non-negative.');
  }
  const match = value.toString().match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i);
  if (match === null) {
    throw new CheckoutValidationError('Product price has an unsupported decimal form.');
  }
  const whole = match[1] ?? '0';
  const fraction = match[2] ?? '';
  const exponent = Number(match[3] ?? '0');
  const digits = `${whole}${fraction}`.replace(/^0+(?=\d)/, '');
  const scale = exponent - fraction.length + 2;
  let minor: bigint;
  if (scale >= 0) {
    if (scale > 100) {
      throw new CheckoutValidationError('Product price exceeds the safe integer range.');
    }
    minor = BigInt(digits) * 10n ** BigInt(scale);
  } else {
    const divisor = 10n ** BigInt(-scale);
    const unscaled = BigInt(digits);
    if (unscaled % divisor !== 0n) {
      throw new CheckoutValidationError('Product price must be exact to one cent.');
    }
    minor = unscaled / divisor;
  }
  return checkedNumber(minor, 'Product price');
}

export function priceCheckout(
  request: CheckoutCreateRequest,
  products: ReadonlyMap<string, PricedProduct>,
  policy: CheckoutPricingPolicy
): CheckoutQuote {
  assertCurrency(policy.currency);
  assertBasisPoints(policy.taxRateBasisPoints);
  assertPositiveLimit(policy.maxItemQuantity, 'maxItemQuantity');
  assertPositiveLimit(policy.maxAggregateQuantity, 'maxAggregateQuantity');
  assertPositiveLimit(policy.maxTotalMinorUnits, 'maxTotalMinorUnits');
  const validatedRequest = parseCheckoutCreateRequest(request, policy);

  let subtotal = 0n;
  const lines = validatedRequest.items.map((item) => {
    const product = products.get(item.productId);
    if (product === undefined || product.isActive === false) {
      throw new CheckoutValidationError(`Unknown or inactive product: ${item.productId}.`);
    }
    if (product.id !== item.productId) {
      throw new CheckoutValidationError('Product identity is inconsistent.');
    }
    assertProductName(product.name);
    const unitPrice = majorUnitsToMinorUnits(product.price);
    const lineSubtotal = BigInt(unitPrice) * BigInt(item.quantity);
    subtotal += lineSubtotal;
    return Object.freeze({
      productId: product.id,
      productName: product.name,
      quantity: item.quantity,
      unitPriceMinorUnits: unitPrice,
      subtotalMinorUnits: checkedNumber(lineSubtotal, 'Line subtotal'),
    });
  });

  // One basket-level, non-negative, half-up rounding operation.
  const tax = (subtotal * BigInt(policy.taxRateBasisPoints) + 5_000n) / 10_000n;
  const total = subtotal + tax;
  if (total > BigInt(policy.maxTotalMinorUnits)) {
    throw new CheckoutValidationError('Checkout total exceeds the configured limit.');
  }

  return Object.freeze({
    currency: policy.currency,
    taxRateBasisPoints: policy.taxRateBasisPoints,
    lines: Object.freeze(lines),
    subtotalMinorUnits: checkedNumber(subtotal, 'Basket subtotal'),
    taxMinorUnits: checkedNumber(tax, 'Basket tax'),
    totalMinorUnits: checkedNumber(total, 'Basket total'),
  });
}

export function assertCheckoutQuote(
  value: unknown,
  limits: Pick<
    CheckoutPricingPolicy,
    'maxItemQuantity' | 'maxAggregateQuantity' | 'maxTotalMinorUnits'
  > = {
    maxItemQuantity: MAX_CHECKOUT_ITEM_QUANTITY,
    maxAggregateQuantity: MAX_CHECKOUT_AGGREGATE_QUANTITY,
    maxTotalMinorUnits: MAX_CHECKOUT_TOTAL_MINOR_UNITS,
  }
): asserts value is CheckoutQuote {
  assertPositiveLimit(limits.maxItemQuantity, 'maxItemQuantity');
  assertPositiveLimit(limits.maxAggregateQuantity, 'maxAggregateQuantity');
  assertPositiveLimit(limits.maxTotalMinorUnits, 'maxTotalMinorUnits');
  const quote = recordWithExactKeys(
    value,
    [
      'currency',
      'taxRateBasisPoints',
      'lines',
      'subtotalMinorUnits',
      'taxMinorUnits',
      'totalMinorUnits',
    ],
    'Quote'
  );
  assertCurrency(quote['currency']);
  assertBasisPoints(quote['taxRateBasisPoints']);
  if (
    !Array.isArray(quote['lines']) ||
    quote['lines'].length < 1 ||
    quote['lines'].length > MAX_CHECKOUT_ITEMS
  ) {
    throw new CheckoutValidationError('Quote lines are invalid.');
  }

  const productIds = new Set<string>();
  let aggregateQuantity = 0n;
  let subtotal = 0n;
  for (const [index, rawLine] of quote['lines'].entries()) {
    const line = recordWithExactKeys(
      rawLine,
      ['productId', 'productName', 'quantity', 'unitPriceMinorUnits', 'subtotalMinorUnits'],
      `Quote lines[${index}]`
    );
    assertProductId(line['productId'], `Quote lines[${index}].productId`);
    if (productIds.has(line['productId'])) {
      throw new CheckoutValidationError(`Duplicate quote product id: ${line['productId']}.`);
    }
    assertProductName(line['productName']);
    assertPositiveSafe(line['quantity'], 'Quote line quantity');
    if (line['quantity'] > limits.maxItemQuantity) {
      throw new CheckoutValidationError('Quote line quantity exceeds the configured limit.');
    }
    aggregateQuantity += BigInt(line['quantity']);
    if (aggregateQuantity > BigInt(limits.maxAggregateQuantity)) {
      throw new CheckoutValidationError('Quote aggregate quantity exceeds the configured limit.');
    }
    assertNonNegativeSafe(line['unitPriceMinorUnits'], 'Quote unit price');
    assertNonNegativeSafe(line['subtotalMinorUnits'], 'Quote line subtotal');
    const expected = BigInt(line['unitPriceMinorUnits']) * BigInt(line['quantity']);
    if (expected !== BigInt(line['subtotalMinorUnits'])) {
      throw new CheckoutValidationError('Quote line arithmetic is inconsistent.');
    }
    subtotal += expected;
    productIds.add(line['productId']);
  }

  assertNonNegativeSafe(quote['subtotalMinorUnits'], 'Quote subtotal');
  assertNonNegativeSafe(quote['taxMinorUnits'], 'Quote tax');
  assertNonNegativeSafe(quote['totalMinorUnits'], 'Quote total');
  if (subtotal !== BigInt(quote['subtotalMinorUnits'])) {
    throw new CheckoutValidationError('Quote subtotal is inconsistent.');
  }
  const tax = (subtotal * BigInt(quote['taxRateBasisPoints']) + 5_000n) / 10_000n;
  if (
    tax !== BigInt(quote['taxMinorUnits']) ||
    subtotal + tax !== BigInt(quote['totalMinorUnits'])
  ) {
    throw new CheckoutValidationError('Quote tax or total is inconsistent.');
  }
  if (quote['totalMinorUnits'] > limits.maxTotalMinorUnits) {
    throw new CheckoutValidationError('Quote total exceeds the configured limit.');
  }
}

export function checkoutQuotesEqual(left: CheckoutQuote, right: CheckoutQuote): boolean {
  assertCheckoutQuote(left);
  assertCheckoutQuote(right);
  return (
    left.currency === right.currency &&
    left.taxRateBasisPoints === right.taxRateBasisPoints &&
    left.subtotalMinorUnits === right.subtotalMinorUnits &&
    left.taxMinorUnits === right.taxMinorUnits &&
    left.totalMinorUnits === right.totalMinorUnits &&
    left.lines.length === right.lines.length &&
    left.lines.every((line, index) => {
      const other = right.lines[index];
      return (
        other !== undefined &&
        line.productId === other.productId &&
        line.productName === other.productName &&
        line.quantity === other.quantity &&
        line.unitPriceMinorUnits === other.unitPriceMinorUnits &&
        line.subtotalMinorUnits === other.subtotalMinorUnits
      );
    })
  );
}

function assertProductId(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > MAX_PRODUCT_ID_LENGTH ||
    hasControlCharacter(value)
  ) {
    throw new CheckoutValidationError(`${label} is invalid.`);
  }
}

function assertProductName(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > 500 ||
    hasControlCharacter(value)
  ) {
    throw new CheckoutValidationError('Product name is invalid.');
  }
}

function hasControlCharacter(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

function recordWithExactKeys(
  value: unknown,
  keys: readonly string[],
  label: string
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CheckoutValidationError(`${label} must be an object.`);
  }
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new CheckoutValidationError(`${label} contains unsupported fields.`);
  }
  return value as Record<string, unknown>;
}

function checkedNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new CheckoutValidationError(`${label} exceeds the safe integer range.`);
  }
  return Number(value);
}

function assertCurrency(value: unknown): asserts value is 'USD' {
  if (value !== 'USD') {
    throw new CheckoutValidationError('Only USD checkout pricing is supported.');
  }
}

function assertBasisPoints(value: unknown): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 10_000) {
    throw new CheckoutValidationError('Tax basis points are invalid.');
  }
}

function assertPositiveLimit(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new CheckoutValidationError(`${label} must be a positive safe integer.`);
  }
}

function assertPositiveSafe(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new CheckoutValidationError(`${label} must be a positive safe integer.`);
  }
}

function assertNonNegativeSafe(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new CheckoutValidationError(`${label} must be a non-negative safe integer.`);
  }
}
