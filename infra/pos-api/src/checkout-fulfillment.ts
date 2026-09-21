import type { DocumentStore, StoredDocument } from '../../shared/src/document-store.ts';
import {
  activeReservedQuantity,
  availableStock,
  type CheckoutInventory,
  type CheckoutInventoryMarkers,
} from './checkout-inventory.ts';
import {
  assertCheckoutQuote,
  checkoutQuotesEqual,
  type CheckoutQuote,
} from './checkout-pricing.ts';

export interface ReservationAwareProductInventory {
  readonly stock: number;
  /** Missing on catalogue documents created before checkout reservations existed. */
  readonly checkoutMarkers?: CheckoutInventoryMarkers;
}

export const CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2 = 'v2' as const;

export interface CheckoutTransactionCustomerBinding {
  readonly customerKey: string;
  readonly keyVersion: 'sha256-v1';
}

interface CheckoutSaleTransactionDocumentBase extends StoredDocument {
  readonly kind: 'checkout-sale';
  readonly type: 'sale';
  readonly checkoutId: string;
  readonly paypalCaptureId: string;
  readonly storeId: string;
  readonly quote: CheckoutQuote;
  readonly timestamp: string;
}

export interface CheckoutSaleTransactionDocumentV1 extends CheckoutSaleTransactionDocumentBase {
  readonly schemaVersion?: never;
  readonly customerBinding?: never;
}

export interface CheckoutSaleTransactionDocumentV2 extends CheckoutSaleTransactionDocumentBase {
  readonly schemaVersion: typeof CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2;
  readonly customerBinding: CheckoutTransactionCustomerBinding | null;
}

export type CheckoutSaleTransactionDocument =
  | CheckoutSaleTransactionDocumentV1
  | CheckoutSaleTransactionDocumentV2;

export type PublicCheckoutSaleTransactionDocument = CheckoutSaleTransactionDocumentBase;

export type CheckoutTransactionPersistenceResult = Readonly<{
  outcome: 'created' | 'replay';
  transaction: CheckoutSaleTransactionDocument;
}>;

export class CheckoutTransactionCorruptionError extends Error {
  readonly code: 'invalid-record' | 'binding-conflict';

  constructor(code: CheckoutTransactionCorruptionError['code']) {
    super(`Checkout transaction is corrupt: ${code}.`);
    this.name = 'CheckoutTransactionCorruptionError';
    this.code = code;
  }
}

const EMPTY_CHECKOUT_MARKERS: CheckoutInventoryMarkers = Object.freeze(
  Object.create(null) as Record<string, never>
);
const TRANSACTION_PREFIX = 'checkout-transaction:';

/** Old product documents migrate lazily: a missing marker map means no reservations. */
export function checkoutInventoryOf(product: ReservationAwareProductInventory): CheckoutInventory {
  const checkoutMarkers = product.checkoutMarkers ?? EMPTY_CHECKOUT_MARKERS;
  // Both helpers validate the persisted marker shape and fail closed on corruption.
  availableStock(product.stock, checkoutMarkers);
  return { stock: product.stock, checkoutMarkers };
}

export function productAvailableStock(product: ReservationAwareProductInventory): number {
  const inventory = checkoutInventoryOf(product);
  return availableStock(inventory.stock, inventory.checkoutMarkers);
}

export function productHasActiveReservations(product: ReservationAwareProductInventory): boolean {
  return activeReservedQuantity(checkoutInventoryOf(product).checkoutMarkers) > 0;
}

/**
 * One deterministic transaction id per checkout closes the create/retry window after capture.
 * A conflicting document is accepted only when its checkout, capture, store and quote bindings
 * are identical; any other collision fails closed instead of fabricating a successful replay.
 */
export async function persistCheckoutTransaction(
  transactions: DocumentStore<StoredDocument>,
  input: {
    readonly checkoutId: string;
    readonly paypalCaptureId: string;
    readonly storeId: string;
    readonly quote: CheckoutQuote;
    readonly completedAt: string;
    readonly schemaVersion?: typeof CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2;
    readonly customerBinding?: CheckoutTransactionCustomerBinding | null;
  }
): Promise<CheckoutTransactionPersistenceResult> {
  assertIdentifier(input.checkoutId, 'checkoutId');
  assertIdentifier(input.paypalCaptureId, 'paypalCaptureId');
  assertIdentifier(input.storeId, 'storeId');
  assertCanonicalUtc(input.completedAt, 'completedAt');
  assertCheckoutQuote(input.quote);
  if (input.schemaVersion === undefined && input.customerBinding !== undefined) {
    throw new Error('customerBinding requires a V2 checkout transaction.');
  }
  if (input.schemaVersion === CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2) {
    validateTransactionCustomerBinding(input.customerBinding ?? null);
  }

  const base: CheckoutSaleTransactionDocumentBase = {
    id: checkoutTransactionId(input.checkoutId),
    kind: 'checkout-sale',
    type: 'sale',
    checkoutId: input.checkoutId,
    paypalCaptureId: input.paypalCaptureId,
    storeId: input.storeId,
    quote: input.quote,
    timestamp: input.completedAt,
  };
  const transaction: CheckoutSaleTransactionDocument =
    input.schemaVersion === CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2
      ? {
          ...base,
          schemaVersion: CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2,
          customerBinding: input.customerBinding ?? null,
        }
      : base;

  if ((await transactions.create(transaction)) === 'created') {
    return { outcome: 'created', transaction };
  }

  const existing = await transactions.read(transaction.id);
  if (existing === null) {
    throw new Error('Checkout transaction conflict could not be reconciled.');
  }
  try {
    assertCheckoutSaleTransaction(existing.document);
  } catch {
    throw new CheckoutTransactionCorruptionError('invalid-record');
  }
  if (
    existing.document.checkoutId !== transaction.checkoutId ||
    existing.document.paypalCaptureId !== transaction.paypalCaptureId ||
    existing.document.storeId !== transaction.storeId ||
    !checkoutQuotesEqual(existing.document.quote, transaction.quote) ||
    !sameTransactionCustomerBinding(existing.document, transaction)
  ) {
    throw new CheckoutTransactionCorruptionError('binding-conflict');
  }

  return { outcome: 'replay', transaction: existing.document };
}

export function checkoutTransactionId(checkoutId: string): string {
  assertIdentifier(checkoutId, 'checkoutId');
  return `${TRANSACTION_PREFIX}${Buffer.from(checkoutId, 'utf8').toString('base64url')}`;
}

/** Removes V2 customer/loyalty metadata before a transaction crosses an HTTP boundary. */
export function publicCheckoutSaleTransaction(
  transaction: CheckoutSaleTransactionDocument
): PublicCheckoutSaleTransactionDocument {
  assertCheckoutSaleTransaction(transaction);
  const {
    schemaVersion: _schemaVersion,
    customerBinding: _customerBinding,
    ...publicRecord
  } = transaction;
  return publicRecord;
}

function assertCheckoutSaleTransaction(
  value: unknown
): asserts value is CheckoutSaleTransactionDocument {
  if (!isRecord(value)) throw new Error('Stored checkout transaction is invalid.');
  const v2 = Object.prototype.hasOwnProperty.call(value, 'schemaVersion');
  const expectedKeys = [
    'id',
    'kind',
    'type',
    'checkoutId',
    'paypalCaptureId',
    'storeId',
    'quote',
    'timestamp',
    ...(v2 ? ['schemaVersion', 'customerBinding'] : []),
  ];
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
    throw new Error('Stored checkout transaction has an invalid shape.');
  }
  if (value['kind'] !== 'checkout-sale' || value['type'] !== 'sale') {
    throw new Error('Stored checkout transaction has an invalid kind.');
  }
  assertIdentifier(value['id'], 'transaction.id');
  assertIdentifier(value['checkoutId'], 'transaction.checkoutId');
  if (value['id'] !== checkoutTransactionId(value['checkoutId'])) {
    throw new Error('Stored checkout transaction id is inconsistent.');
  }
  assertIdentifier(value['paypalCaptureId'], 'transaction.paypalCaptureId');
  assertIdentifier(value['storeId'], 'transaction.storeId');
  assertCheckoutQuote(value['quote']);
  assertCanonicalUtc(value['timestamp'], 'transaction.timestamp');
  if (v2) {
    if (value['schemaVersion'] !== CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2) {
      throw new Error('Stored checkout transaction has an invalid version.');
    }
    validateTransactionCustomerBinding(value['customerBinding']);
  }
}

function validateTransactionCustomerBinding(
  value: unknown
): asserts value is CheckoutTransactionCustomerBinding | null {
  if (value === null) return;
  if (!isRecord(value)) throw new Error('transaction.customerBinding is invalid.');
  const expectedKeys = ['customerKey', 'keyVersion'];
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
    throw new Error('transaction.customerBinding has an invalid shape.');
  }
  assertIdentifier(value['customerKey'], 'transaction.customerBinding.customerKey');
  if (value['keyVersion'] !== 'sha256-v1') {
    throw new Error('transaction.customerBinding.keyVersion is invalid.');
  }
}

function sameTransactionCustomerBinding(
  left: CheckoutSaleTransactionDocument,
  right: CheckoutSaleTransactionDocument
): boolean {
  const leftV2 = left.schemaVersion === CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2;
  const rightV2 = right.schemaVersion === CHECKOUT_TRANSACTION_SCHEMA_VERSION_V2;
  if (leftV2 !== rightV2) return false;
  if (!leftV2 || !rightV2) return true;
  if (left.customerBinding === null || right.customerBinding === null) {
    return left.customerBinding === right.customerBinding;
  }
  return (
    left.customerBinding.customerKey === right.customerBinding.customerKey &&
    left.customerBinding.keyVersion === right.customerBinding.keyVersion
  );
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 500 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertCanonicalUtc(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
