export const CheckoutInventoryMarkerState = {
  RESERVED: 'reserved',
  COMMITTED: 'committed',
} as const;

export interface ReservedCheckoutInventoryMarker {
  readonly state: 'reserved';
  readonly quantity: number;
  readonly reservedAt: string;
}

export interface CommittedCheckoutInventoryMarker {
  readonly state: 'committed';
  readonly quantity: number;
  readonly reservedAt: string;
  readonly committedAt: string;
}

export type CheckoutInventoryMarker =
  | ReservedCheckoutInventoryMarker
  | CommittedCheckoutInventoryMarker;
export type CheckoutInventoryMarkers = Readonly<Record<string, CheckoutInventoryMarker>>;

export interface CheckoutInventory {
  readonly stock: number;
  readonly checkoutMarkers: CheckoutInventoryMarkers;
}

export class CheckoutInventoryError extends Error {
  readonly code:
    | 'invalid-inventory'
    | 'insufficient-stock'
    | 'quantity-mismatch'
    | 'marker-not-found'
    | 'committed-marker';

  constructor(
    code:
      | 'invalid-inventory'
      | 'insufficient-stock'
      | 'quantity-mismatch'
      | 'marker-not-found'
      | 'committed-marker',
    message: string
  ) {
    super(message);
    this.name = 'CheckoutInventoryError';
    this.code = code;
  }
}

export function activeReservedQuantity(markers: CheckoutInventoryMarkers): number {
  const validated = validateMarkers(markers);
  let total = 0n;
  for (const marker of Object.values(validated)) {
    if (marker.state === 'reserved') total += BigInt(marker.quantity);
  }
  return checkedNumber(total, 'Active reservations');
}

export function availableStock(stock: number, markers: CheckoutInventoryMarkers): number {
  assertNonNegativeSafeInteger(stock, 'Stock');
  const reserved = activeReservedQuantity(markers);
  if (reserved > stock) invalid('Active reservations exceed physical stock.');
  return stock - reserved;
}

export function reserve(
  inventory: CheckoutInventory,
  checkoutId: string,
  quantity: number,
  reservedAt: string
): CheckoutInventory {
  const current = validateInventory(inventory);
  assertCheckoutId(checkoutId);
  assertPositiveSafeInteger(quantity, 'Quantity');
  canonicalUtcEpoch(reservedAt, 'Reservation timestamp');
  const existing = ownMarker(current.checkoutMarkers, checkoutId);
  if (existing !== undefined) {
    if (existing.quantity !== quantity) {
      throw new CheckoutInventoryError('quantity-mismatch', 'Checkout quantity does not match.');
    }
    return immutableInventory(current.stock, current.checkoutMarkers);
  }
  if (availableStock(current.stock, current.checkoutMarkers) < quantity) {
    throw new CheckoutInventoryError('insufficient-stock', 'Insufficient available stock.');
  }
  const markers = mutableNullPrototypeCopy(current.checkoutMarkers);
  Object.defineProperty(markers, checkoutId, {
    value: Object.freeze({ state: 'reserved' as const, quantity, reservedAt }),
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return immutableInventory(current.stock, markers);
}

export function release(inventory: CheckoutInventory, checkoutId: string): CheckoutInventory {
  const current = validateInventory(inventory);
  assertCheckoutId(checkoutId);
  const existing = ownMarker(current.checkoutMarkers, checkoutId);
  if (existing === undefined) return immutableInventory(current.stock, current.checkoutMarkers);
  if (existing.state === 'committed') {
    throw new CheckoutInventoryError('committed-marker', 'Committed inventory cannot be released.');
  }
  const markers = mutableNullPrototypeCopy(current.checkoutMarkers);
  delete markers[checkoutId];
  return immutableInventory(current.stock, markers);
}

export function commit(
  inventory: CheckoutInventory,
  checkoutId: string,
  committedAt: string
): CheckoutInventory {
  const current = validateInventory(inventory);
  assertCheckoutId(checkoutId);
  const commitEpoch = canonicalUtcEpoch(committedAt, 'Commit timestamp');
  const existing = ownMarker(current.checkoutMarkers, checkoutId);
  if (existing === undefined) {
    throw new CheckoutInventoryError('marker-not-found', 'Inventory reservation does not exist.');
  }
  if (existing.state === 'committed')
    return immutableInventory(current.stock, current.checkoutMarkers);
  if (commitEpoch < canonicalUtcEpoch(existing.reservedAt, 'Reservation timestamp')) {
    invalid('Commit timestamp precedes reservation timestamp.');
  }
  if (existing.quantity > current.stock) invalid('Reservation exceeds physical stock.');
  const markers = mutableNullPrototypeCopy(current.checkoutMarkers);
  Object.defineProperty(markers, checkoutId, {
    value: Object.freeze({ ...existing, state: 'committed' as const, committedAt }),
    enumerable: true,
    configurable: true,
    writable: true,
  });
  return immutableInventory(current.stock - existing.quantity, markers);
}

function validateInventory(value: CheckoutInventory): CheckoutInventory {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid('Inventory is invalid.');
  assertNonNegativeSafeInteger(value.stock, 'Stock');
  const markers = validateMarkers(value.checkoutMarkers);
  if (activeReservedQuantityUnchecked(markers) > value.stock) invalid('Reservations exceed stock.');
  return immutableInventory(value.stock, markers);
}

function validateMarkers(value: CheckoutInventoryMarkers): CheckoutInventoryMarkers {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    invalid('Markers are invalid.');
  const copy: Record<string, CheckoutInventoryMarker> = Object.create(null);
  for (const [checkoutId, raw] of Object.entries(value as Record<string, unknown>)) {
    assertCheckoutId(checkoutId);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
      invalid('Marker is invalid.');
    const marker = raw as Record<string, unknown>;
    const expectedKeys =
      marker['state'] === 'reserved'
        ? ['state', 'quantity', 'reservedAt']
        : ['state', 'quantity', 'reservedAt', 'committedAt'];
    const actualKeys = Object.keys(marker);
    if (
      actualKeys.length !== expectedKeys.length ||
      actualKeys.some((key) => !expectedKeys.includes(key))
    ) {
      invalid('Marker shape is invalid.');
    }
    assertPositiveSafeInteger(marker['quantity'], 'Marker quantity');
    const reservedEpoch = canonicalUtcEpoch(marker['reservedAt'], 'Reservation timestamp');
    let normalized: CheckoutInventoryMarker;
    if (marker['state'] === 'reserved') {
      normalized = Object.freeze({
        state: 'reserved',
        quantity: marker['quantity'],
        reservedAt: marker['reservedAt'] as string,
      });
    } else if (marker['state'] === 'committed') {
      const committedEpoch = canonicalUtcEpoch(marker['committedAt'], 'Commit timestamp');
      if (committedEpoch < reservedEpoch)
        invalid('Commit timestamp precedes reservation timestamp.');
      normalized = Object.freeze({
        state: 'committed',
        quantity: marker['quantity'],
        reservedAt: marker['reservedAt'] as string,
        committedAt: marker['committedAt'] as string,
      });
    } else invalid('Marker state is invalid.');
    Object.defineProperty(copy, checkoutId, {
      value: normalized,
      enumerable: true,
      configurable: false,
      writable: false,
    });
  }
  return Object.freeze(copy);
}

function immutableInventory(stock: number, markers: CheckoutInventoryMarkers): CheckoutInventory {
  return Object.freeze({ stock, checkoutMarkers: validateMarkers(markers) });
}

function mutableNullPrototypeCopy(
  markers: CheckoutInventoryMarkers
): Record<string, CheckoutInventoryMarker> {
  const copy: Record<string, CheckoutInventoryMarker> = Object.create(null);
  for (const [key, value] of Object.entries(markers)) {
    Object.defineProperty(copy, key, {
      value,
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }
  return copy;
}

function ownMarker(
  markers: CheckoutInventoryMarkers,
  checkoutId: string
): CheckoutInventoryMarker | undefined {
  return Object.hasOwn(markers, checkoutId) ? markers[checkoutId] : undefined;
}

function activeReservedQuantityUnchecked(markers: CheckoutInventoryMarkers): number {
  let total = 0n;
  for (const marker of Object.values(markers))
    if (marker.state === 'reserved') total += BigInt(marker.quantity);
  return checkedNumber(total, 'Active reservations');
}

function assertCheckoutId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    invalid('Checkout id is invalid.');
  }
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${label} is invalid.`);
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`${label} is invalid.`);
}

function canonicalUtcEpoch(value: unknown, label: string): number {
  if (typeof value !== 'string') invalid(`${label} is invalid.`);
  const epoch = Date.parse(value as string);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value)
    invalid(`${label} is invalid.`);
  return epoch;
}

function checkedNumber(value: bigint, label: string): number {
  if (value < 0n || value > BigInt(Number.MAX_SAFE_INTEGER)) invalid(`${label} is unsafe.`);
  return Number(value);
}

function invalid(message: string): never {
  throw new CheckoutInventoryError('invalid-inventory', message);
}
