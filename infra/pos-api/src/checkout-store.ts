import type {
  CreateOutcome,
  DocumentStore,
  StoredDocument,
  WriteOutcome,
} from '../../shared/src/document-store.ts';
import {
  assertCheckoutQuote,
  checkoutQuotesEqual,
  type CheckoutQuote,
} from './checkout-pricing.ts';
import {
  assertCheckoutTransition,
  CheckoutState,
  isCheckoutState,
  isTerminalCheckoutState,
} from './checkout-state.ts';

export interface CheckoutLease {
  readonly ownerId: string;
  readonly leaseId: string;
  readonly expiresAt: string;
}

export interface CheckoutLeaseFence {
  readonly ownerId: string;
  readonly leaseId: string;
  readonly nowIso: string;
}

export interface CheckoutFailure {
  readonly code: string;
  readonly at: string;
  readonly retryable: boolean;
  readonly detail: string;
}

export interface CheckoutReceiptProjection {
  readonly transactionId: string;
  readonly checkoutId: string;
  readonly quote: CheckoutQuote;
  readonly paypalCaptureId: string;
  readonly completedAt: string;
}

export interface CheckoutDocument extends StoredDocument {
  readonly kind: 'checkout';
  readonly idempotencyKeyHash: string;
  readonly idempotencyKeyVersion: string;
  readonly requestFingerprint: string;
  readonly capabilityTokenHash: string;
  readonly capabilityKeyVersion: string;
  readonly storeId: string;
  readonly expectedPayPalMerchantId: string;
  readonly state: CheckoutState;
  readonly quote: CheckoutQuote;
  readonly paypalOrderId: string | null;
  readonly paypalAuthorizationId: string | null;
  readonly paypalCaptureId: string | null;
  readonly paypalRequestIds: Readonly<{
    createOrder: string;
    authorizeOrder: string;
    captureAuthorization: string;
    voidAuthorization: string;
  }>;
  readonly receipt: CheckoutReceiptProjection | null;
  readonly lastFailure: CheckoutFailure | null;
  readonly attempts: number;
  readonly nextActionAt: string | null;
  readonly lease: CheckoutLease | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
}

interface IdempotencyClaimDocument extends StoredDocument {
  readonly kind: 'checkout-idempotency-claim';
  readonly keyHash: string;
  readonly keyVersion: string;
  readonly requestFingerprint: string;
  readonly checkoutId: string;
  readonly createdAt: string;
}

export type PayPalReferenceKind = 'order' | 'authorization' | 'capture';

interface ProviderBindingDocument extends StoredDocument {
  readonly kind: 'checkout-provider-binding';
  readonly referenceKind: PayPalReferenceKind;
  readonly referenceId: string;
  readonly checkoutId: string;
  readonly createdAt: string;
}

export type CheckoutStoredDocument =
  | CheckoutDocument
  | IdempotencyClaimDocument
  | ProviderBindingDocument;

export type ClaimResult =
  | { readonly outcome: 'claimed'; readonly checkoutId: string }
  | { readonly outcome: 'replay'; readonly checkoutId: string }
  | { readonly outcome: 'conflict'; readonly checkoutId: string }
  | { readonly outcome: 'digest-collision' };

export type ClaimLookupResult =
  | { readonly outcome: 'missing' }
  | { readonly outcome: 'replay'; readonly checkoutId: string }
  | { readonly outcome: 'conflict'; readonly checkoutId: string }
  | { readonly outcome: 'digest-collision' };

export type BindingResult =
  | { readonly outcome: 'claimed' | 'replay' }
  | { readonly outcome: 'conflict'; readonly checkoutId: string }
  | { readonly outcome: 'digest-collision' };

declare const checkoutRevisionBrand: unique symbol;

/** Process-local opaque capability issued only by this repository's read method. */
export interface CheckoutRevision {
  readonly [checkoutRevisionBrand]: true;
}

export interface VersionedCheckout {
  readonly document: CheckoutDocument;
  readonly revision: CheckoutRevision;
}

export type LeaseAcquireResult =
  | { readonly outcome: 'acquired' | 'replay'; readonly checkout: VersionedCheckout }
  | { readonly outcome: 'busy'; readonly ownerId: string; readonly expiresAt: string }
  | { readonly outcome: 'not-found' | 'conflict' };

export type LeaseMutationResult = 'written' | 'lost' | 'not-found' | 'conflict';

export interface DueCheckoutCursor {
  readonly asOf: string;
  readonly nextActionAt: string;
  readonly checkoutId: string;
}

export interface DueCheckoutPage {
  readonly checkouts: readonly CheckoutDocument[];
  readonly nextCursor: DueCheckoutCursor | null;
}

/**
 * Production implementations must use a database index and bound work before loading
 * documents. Pages are at-least-once: callers must acquire a lease and reconcile
 * idempotently because rows can be rescheduled between pages.
 */
export interface DueCheckoutReader {
  listDue(input: {
    readonly asOf: string;
    readonly limit: number;
    readonly cursor?: DueCheckoutCursor;
  }): Promise<DueCheckoutPage>;
}

export interface CheckoutRepository extends DueCheckoutReader {
  create(checkout: CheckoutDocument): Promise<CreateOutcome>;
  read(checkoutId: string): Promise<VersionedCheckout | null>;
  compareAndSwap(
    checkoutId: string,
    checkout: CheckoutDocument,
    expectedRevision: CheckoutRevision,
    leaseFence?: CheckoutLeaseFence
  ): Promise<WriteOutcome>;
  lookupIdempotency(input: {
    keyHash: string;
    keyVersion: string;
    requestFingerprint: string;
  }): Promise<ClaimLookupResult>;
  claimIdempotency(input: {
    keyHash: string;
    keyVersion: string;
    requestFingerprint: string;
    checkoutId: string;
    nowIso: string;
  }): Promise<ClaimResult>;
  bindProviderReference(input: {
    referenceKind: PayPalReferenceKind;
    referenceId: string;
    checkoutId: string;
    nowIso: string;
  }): Promise<BindingResult>;
  tryAcquireLease(input: {
    checkoutId: string;
    ownerId: string;
    leaseId: string;
    nowIso: string;
    expiresAtIso: string;
  }): Promise<LeaseAcquireResult>;
  renewLease(input: {
    checkoutId: string;
    ownerId: string;
    leaseId: string;
    nowIso: string;
    expiresAtIso: string;
  }): Promise<LeaseMutationResult>;
  releaseLease(input: {
    checkoutId: string;
    ownerId: string;
    leaseId: string;
    nowIso: string;
  }): Promise<LeaseMutationResult>;
}

const MAX_LEASE_CAS_ATTEMPTS = 5;
const MAX_DUE_PAGE_SIZE = 100;
const CLAIM_PREFIX = 'checkout-claim:idempotency:';
const BINDING_PREFIX = 'checkout-claim:paypal:';

export class DocumentCheckoutStore implements CheckoutRepository {
  private readonly documents: DocumentStore<CheckoutStoredDocument>;
  private readonly digest: (canonicalInput: string) => string;
  private readonly dueReader: DueCheckoutReader;
  private readonly revisions = new WeakMap<
    CheckoutRevision,
    { checkoutId: string; token: string }
  >();

  constructor(
    documents: DocumentStore<CheckoutStoredDocument>,
    digest: (canonicalInput: string) => string,
    dueReader: DueCheckoutReader
  ) {
    this.documents = documents;
    this.digest = digest;
    this.dueReader = dueReader;
  }

  async create(checkout: CheckoutDocument): Promise<CreateOutcome> {
    assertCheckoutDocument(checkout);
    assertCheckoutIdNamespace(checkout.id);
    return this.documents.create(checkout);
  }

  async read(checkoutId: string): Promise<VersionedCheckout | null> {
    assertCheckoutIdNamespace(checkoutId);
    const revision = await this.documents.read(checkoutId);
    if (revision === null) return null;
    if (!isRecord(revision.document) || revision.document['kind'] !== 'checkout') {
      throw corrupt('Expected checkout document.');
    }
    assertCheckoutDocument(revision.document);
    const checkoutRevision = Object.freeze({}) as CheckoutRevision;
    this.revisions.set(checkoutRevision, { checkoutId, token: revision.rev });
    return {
      document: revision.document as CheckoutDocument,
      revision: checkoutRevision,
    };
  }

  async compareAndSwap(
    checkoutId: string,
    checkout: CheckoutDocument,
    expectedRevision: CheckoutRevision,
    leaseFence?: CheckoutLeaseFence
  ): Promise<WriteOutcome> {
    assertCheckoutIdNamespace(checkoutId);
    assertCheckoutDocument(checkout);
    if (checkout.id !== checkoutId) {
      throw new Error('Checkout id is immutable across compare-and-swap.');
    }
    const revision = this.revisions.get(expectedRevision);
    if (revision === undefined || revision.checkoutId !== checkoutId) return 'conflict';
    const current = await this.read(checkoutId);
    const currentRevision = current ? this.revisions.get(current.revision) : undefined;
    if (current === null || currentRevision?.token !== revision.token) return 'conflict';
    if (leaseFence !== undefined) {
      validateLeaseFence(leaseFence);
      const lease = current.document.lease;
      if (
        lease === null ||
        lease.ownerId !== leaseFence.ownerId ||
        lease.leaseId !== leaseFence.leaseId ||
        canonicalUtcEpoch(lease.expiresAt, 'lease.expiresAt') <=
          canonicalUtcEpoch(leaseFence.nowIso, 'leaseFence.nowIso')
      ) {
        return 'conflict';
      }
      if (checkout.lease !== null && !sameLease(checkout.lease, lease)) {
        throw new Error('A fenced checkout mutation cannot replace its lease.');
      }
    }
    assertImmutableCheckoutBindings(current.document, checkout);
    if (current.document.state !== checkout.state) {
      assertCheckoutTransition(current.document.state, checkout.state);
    }
    if (
      canonicalUtcEpoch(checkout.updatedAt, 'updatedAt') < Date.parse(current.document.updatedAt)
    ) {
      throw corrupt('updatedAt cannot move backwards.');
    }
    return this.documents.write(checkout, revision.token);
  }

  async lookupIdempotency(input: {
    keyHash: string;
    keyVersion: string;
    requestFingerprint: string;
  }): Promise<ClaimLookupResult> {
    nonEmpty(input.keyHash, 'keyHash');
    nonEmpty(input.keyVersion, 'keyVersion');
    nonEmpty(input.requestFingerprint, 'requestFingerprint');
    const id = this.idempotencyClaimId(input.keyVersion, input.keyHash);
    const existing = await this.documents.read(id);
    if (existing === null) return { outcome: 'missing' };
    if (existing.document.kind !== 'checkout-idempotency-claim') {
      return { outcome: 'digest-collision' };
    }
    const doc = existing.document;
    if (doc.keyHash !== input.keyHash || doc.keyVersion !== input.keyVersion) {
      return { outcome: 'digest-collision' };
    }
    validateClaim(doc);
    return doc.requestFingerprint === input.requestFingerprint
      ? { outcome: 'replay', checkoutId: doc.checkoutId }
      : { outcome: 'conflict', checkoutId: doc.checkoutId };
  }

  async claimIdempotency(input: {
    keyHash: string;
    keyVersion: string;
    requestFingerprint: string;
    checkoutId: string;
    nowIso: string;
  }): Promise<ClaimResult> {
    nonEmpty(input.keyHash, 'keyHash');
    nonEmpty(input.keyVersion, 'keyVersion');
    nonEmpty(input.requestFingerprint, 'requestFingerprint');
    assertCheckoutIdNamespace(input.checkoutId);
    canonicalUtcEpoch(input.nowIso, 'nowIso');
    const id = this.idempotencyClaimId(input.keyVersion, input.keyHash);
    const claim: IdempotencyClaimDocument = {
      id,
      kind: 'checkout-idempotency-claim',
      keyHash: input.keyHash,
      keyVersion: input.keyVersion,
      requestFingerprint: input.requestFingerprint,
      checkoutId: input.checkoutId,
      createdAt: input.nowIso,
    };
    if ((await this.documents.create(claim)) === 'created') {
      return { outcome: 'claimed', checkoutId: input.checkoutId };
    }
    const existing = await this.documents.read(id);
    if (existing?.document.kind !== 'checkout-idempotency-claim')
      return { outcome: 'digest-collision' };
    const doc = existing.document;
    if (doc.keyHash !== input.keyHash || doc.keyVersion !== input.keyVersion) {
      return { outcome: 'digest-collision' };
    }
    validateClaim(doc);
    if (doc.requestFingerprint === input.requestFingerprint) {
      return { outcome: 'replay', checkoutId: doc.checkoutId };
    }
    return { outcome: 'conflict', checkoutId: doc.checkoutId };
  }

  async bindProviderReference(input: {
    referenceKind: PayPalReferenceKind;
    referenceId: string;
    checkoutId: string;
    nowIso: string;
  }): Promise<BindingResult> {
    assertReferenceKind(input.referenceKind);
    nonEmpty(input.referenceId, 'referenceId');
    assertCheckoutIdNamespace(input.checkoutId);
    canonicalUtcEpoch(input.nowIso, 'nowIso');
    const canonical = `${input.referenceKind}\0${input.referenceId}`;
    const id = `${BINDING_PREFIX}${input.referenceKind}:${safeDigest(this.digest(`paypal\0${canonical}`))}`;
    const binding: ProviderBindingDocument = {
      id,
      kind: 'checkout-provider-binding',
      referenceKind: input.referenceKind,
      referenceId: input.referenceId,
      checkoutId: input.checkoutId,
      createdAt: input.nowIso,
    };
    if ((await this.documents.create(binding)) === 'created') return { outcome: 'claimed' };
    const existing = await this.documents.read(id);
    if (existing?.document.kind !== 'checkout-provider-binding')
      return { outcome: 'digest-collision' };
    const doc = existing.document;
    if (doc.referenceKind !== input.referenceKind || doc.referenceId !== input.referenceId) {
      return { outcome: 'digest-collision' };
    }
    validateBinding(doc);
    return doc.checkoutId === input.checkoutId
      ? { outcome: 'replay' }
      : { outcome: 'conflict', checkoutId: doc.checkoutId };
  }

  async tryAcquireLease(input: {
    checkoutId: string;
    ownerId: string;
    leaseId: string;
    nowIso: string;
    expiresAtIso: string;
  }): Promise<LeaseAcquireResult> {
    validateLeaseInput(input);
    const now = canonicalUtcEpoch(input.nowIso, 'nowIso');
    const expiry = canonicalUtcEpoch(input.expiresAtIso, 'expiresAtIso');
    if (expiry <= now) throw new Error('Lease expiry must be after now.');
    for (let attempt = 0; attempt < MAX_LEASE_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.read(input.checkoutId);
      if (current === null) return { outcome: 'not-found' };
      const lease = current.document.lease;
      if (lease !== null) {
        const currentExpiry = canonicalUtcEpoch(lease.expiresAt, 'lease.expiresAt');
        if (currentExpiry > now) {
          if (lease.ownerId === input.ownerId && lease.leaseId === input.leaseId) {
            return { outcome: 'replay', checkout: current };
          }
          return { outcome: 'busy', ownerId: lease.ownerId, expiresAt: lease.expiresAt };
        }
      }
      const next = { ...current.document, lease: leaseOf(input), updatedAt: input.nowIso };
      if ((await this.compareAndSwap(input.checkoutId, next, current.revision)) === 'conflict')
        continue;
      const acquired = await this.read(input.checkoutId);
      if (
        acquired?.document.lease?.ownerId !== input.ownerId ||
        acquired.document.lease.leaseId !== input.leaseId
      ) {
        return { outcome: 'conflict' };
      }
      return { outcome: 'acquired', checkout: acquired };
    }
    return { outcome: 'conflict' };
  }

  async renewLease(input: {
    checkoutId: string;
    ownerId: string;
    leaseId: string;
    nowIso: string;
    expiresAtIso: string;
  }): Promise<LeaseMutationResult> {
    validateLeaseInput(input);
    const now = canonicalUtcEpoch(input.nowIso, 'nowIso');
    if (canonicalUtcEpoch(input.expiresAtIso, 'expiresAtIso') <= now)
      throw new Error('Lease expiry must be after now.');
    return this.mutateLease(input, now, leaseOf(input));
  }

  async releaseLease(input: {
    checkoutId: string;
    ownerId: string;
    leaseId: string;
    nowIso: string;
  }): Promise<LeaseMutationResult> {
    validateLeaseInput(input);
    const now = canonicalUtcEpoch(input.nowIso, 'nowIso');
    return this.mutateLease(input, now, null);
  }

  async listDue(input: {
    asOf: string;
    limit: number;
    cursor?: DueCheckoutCursor;
  }): Promise<DueCheckoutPage> {
    canonicalUtcEpoch(input.asOf, 'asOf');
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_DUE_PAGE_SIZE) {
      throw new Error(`limit must be between 1 and ${MAX_DUE_PAGE_SIZE}.`);
    }
    if (input.cursor !== undefined) {
      if (input.cursor.asOf !== input.asOf) throw new Error('Cursor cutoff does not match.');
      canonicalUtcEpoch(input.cursor.nextActionAt, 'cursor.nextActionAt');
      assertCheckoutIdNamespace(input.cursor.checkoutId);
    }
    const page = await this.dueReader.listDue(input);
    if (!isRecord(page) || !Array.isArray(page.checkouts)) {
      throw corrupt('Due reader returned an invalid page.');
    }
    if (page.checkouts.length > input.limit) throw corrupt('Due reader exceeded requested limit.');
    let previous: DueCheckoutCursor | undefined = input.cursor;
    for (const checkout of page.checkouts) {
      assertCheckoutDocument(checkout);
      const dueAt = checkout.nextActionAt;
      if (dueAt === null || canonicalUtcEpoch(dueAt, 'nextActionAt') > Date.parse(input.asOf)) {
        throw corrupt('Due reader returned a checkout outside the cutoff.');
      }
      if (isTerminalCheckoutState(checkout.state)) {
        throw corrupt('Due reader returned a terminal checkout.');
      }
      const current = { asOf: input.asOf, nextActionAt: dueAt, checkoutId: checkout.id };
      if (previous !== undefined && compareCursor(previous, current) >= 0) {
        throw corrupt('Due reader page is not strictly ordered.');
      }
      previous = current;
    }
    if (page.nextCursor !== null) {
      validateDueCursor(page.nextCursor, input.asOf);
      if (
        previous === undefined ||
        page.nextCursor.nextActionAt !== previous.nextActionAt ||
        page.nextCursor.checkoutId !== previous.checkoutId
      ) {
        throw corrupt('Due reader cursor does not match the last checkout.');
      }
    }
    return { checkouts: page.checkouts, nextCursor: page.nextCursor };
  }

  private idempotencyClaimId(keyVersion: string, keyHash: string): string {
    return `${CLAIM_PREFIX}${safeDigest(this.digest(`idempotency\0${keyVersion}\0${keyHash}`))}`;
  }

  private async mutateLease(
    input: { checkoutId: string; ownerId: string; leaseId: string; nowIso: string },
    now: number,
    replacement: CheckoutLease | null
  ): Promise<LeaseMutationResult> {
    for (let attempt = 0; attempt < MAX_LEASE_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.read(input.checkoutId);
      if (current === null) return 'not-found';
      const lease = current.document.lease;
      if (
        lease === null ||
        lease.ownerId !== input.ownerId ||
        lease.leaseId !== input.leaseId ||
        canonicalUtcEpoch(lease.expiresAt, 'lease.expiresAt') <= now
      )
        return 'lost';
      const next = { ...current.document, lease: replacement, updatedAt: input.nowIso };
      if ((await this.compareAndSwap(input.checkoutId, next, current.revision)) === 'written')
        return 'written';
    }
    return 'conflict';
  }
}

/** Local/test-only at-least-once reader. Production must use an indexed bounded query. */
export class MemoryDueCheckoutReader implements DueCheckoutReader {
  private readonly documents: DocumentStore<CheckoutStoredDocument>;

  constructor(documents: DocumentStore<CheckoutStoredDocument>) {
    this.documents = documents;
  }

  async listDue(input: {
    asOf: string;
    limit: number;
    cursor?: DueCheckoutCursor;
  }): Promise<DueCheckoutPage> {
    const asOf = canonicalUtcEpoch(input.asOf, 'asOf');
    const cursorEpoch = input.cursor
      ? canonicalUtcEpoch(input.cursor.nextActionAt, 'cursor.nextActionAt')
      : null;
    const due = (await this.documents.list())
      .filter((document): document is CheckoutDocument => document.kind === 'checkout')
      .map((document) => {
        assertCheckoutDocument(document);
        return {
          document,
          epoch: document.nextActionAt
            ? canonicalUtcEpoch(document.nextActionAt, 'nextActionAt')
            : null,
        };
      })
      .filter(
        (entry): entry is { document: CheckoutDocument; epoch: number } =>
          entry.epoch !== null &&
          entry.epoch <= asOf &&
          !isTerminalCheckoutState(entry.document.state)
      )
      .filter(
        (entry) =>
          !input.cursor ||
          entry.epoch > cursorEpoch! ||
          (entry.epoch === cursorEpoch && entry.document.id > input.cursor.checkoutId)
      )
      .sort((a, b) => a.epoch - b.epoch || a.document.id.localeCompare(b.document.id));
    const selected = due.slice(0, input.limit);
    const last = selected.at(-1);
    return {
      checkouts: selected.map((entry) => entry.document),
      nextCursor:
        due.length > selected.length && last
          ? {
              asOf: input.asOf,
              nextActionAt: last.document.nextActionAt!,
              checkoutId: last.document.id,
            }
          : null,
    };
  }
}

function assertCheckoutDocument(value: unknown): asserts value is CheckoutDocument {
  const document = exactRecord(
    value,
    [
      'id',
      'kind',
      'idempotencyKeyHash',
      'idempotencyKeyVersion',
      'requestFingerprint',
      'capabilityTokenHash',
      'capabilityKeyVersion',
      'storeId',
      'expectedPayPalMerchantId',
      'state',
      'quote',
      'paypalOrderId',
      'paypalAuthorizationId',
      'paypalCaptureId',
      'paypalRequestIds',
      'receipt',
      'lastFailure',
      'attempts',
      'nextActionAt',
      'lease',
      'createdAt',
      'updatedAt',
      'expiresAt',
    ],
    'checkout'
  );
  if (document['kind'] !== 'checkout') throw corrupt('Invalid checkout kind.');
  assertCheckoutIdNamespace(document['id']);
  for (const [field, label] of [
    ['idempotencyKeyHash', 'idempotencyKeyHash'],
    ['idempotencyKeyVersion', 'idempotencyKeyVersion'],
    ['requestFingerprint', 'requestFingerprint'],
    ['capabilityTokenHash', 'capabilityTokenHash'],
    ['capabilityKeyVersion', 'capabilityKeyVersion'],
    ['storeId', 'storeId'],
    ['expectedPayPalMerchantId', 'expectedPayPalMerchantId'],
  ] as const) {
    nonEmpty(document[field], label);
  }
  if (!isCheckoutState(document['state'])) throw corrupt('Invalid checkout state.');
  assertCheckoutQuote(document['quote']);
  const requestIds = exactRecord(
    document['paypalRequestIds'],
    ['createOrder', 'authorizeOrder', 'captureAuthorization', 'voidAuthorization'],
    'paypalRequestIds'
  );
  for (const field of [
    'createOrder',
    'authorizeOrder',
    'captureAuthorization',
    'voidAuthorization',
  ]) {
    nonEmpty(requestIds[field], `paypalRequestIds.${field}`);
  }
  nullableNonEmpty(document['paypalOrderId'], 'paypalOrderId');
  nullableNonEmpty(document['paypalAuthorizationId'], 'paypalAuthorizationId');
  nullableNonEmpty(document['paypalCaptureId'], 'paypalCaptureId');
  nonNegativeSafe(document['attempts'], 'attempts');
  const created = canonicalUtcEpoch(document['createdAt'], 'createdAt');
  const updated = canonicalUtcEpoch(document['updatedAt'], 'updatedAt');
  const expires = canonicalUtcEpoch(document['expiresAt'], 'expiresAt');
  if (updated < created || expires < created)
    throw corrupt('Checkout timestamps are out of order.');
  if (document['nextActionAt'] !== null)
    canonicalUtcEpoch(document['nextActionAt'], 'nextActionAt');
  if (document['lease'] !== null) validateLease(document['lease']);
  if (document['lastFailure'] !== null) validateFailure(document['lastFailure']);

  const checkout = document as unknown as CheckoutDocument;
  if (
    isTerminalCheckoutState(checkout.state) &&
    (checkout.nextActionAt !== null || checkout.lease !== null)
  ) {
    throw corrupt('Terminal checkout cannot remain scheduled or leased.');
  }
  validateStateBindings(checkout);
  if (checkout.receipt !== null) validateReceipt(checkout.receipt, checkout);
}

function assertImmutableCheckoutBindings(current: CheckoutDocument, next: CheckoutDocument): void {
  if (
    current.idempotencyKeyHash !== next.idempotencyKeyHash ||
    current.idempotencyKeyVersion !== next.idempotencyKeyVersion ||
    current.requestFingerprint !== next.requestFingerprint ||
    current.capabilityTokenHash !== next.capabilityTokenHash ||
    current.capabilityKeyVersion !== next.capabilityKeyVersion ||
    current.storeId !== next.storeId ||
    current.expectedPayPalMerchantId !== next.expectedPayPalMerchantId ||
    current.createdAt !== next.createdAt ||
    current.expiresAt !== next.expiresAt ||
    !checkoutQuotesEqual(current.quote, next.quote) ||
    !sameRequestIds(current.paypalRequestIds, next.paypalRequestIds)
  ) {
    throw new Error('Immutable checkout bindings cannot change.');
  }
  for (const field of ['paypalOrderId', 'paypalAuthorizationId', 'paypalCaptureId'] as const) {
    if (current[field] !== null && current[field] !== next[field]) {
      throw new Error(`${field} is immutable once set.`);
    }
  }
}

function sameRequestIds(
  left: CheckoutDocument['paypalRequestIds'],
  right: CheckoutDocument['paypalRequestIds']
): boolean {
  return (
    left.createOrder === right.createOrder &&
    left.authorizeOrder === right.authorizeOrder &&
    left.captureAuthorization === right.captureAuthorization &&
    left.voidAuthorization === right.voidAuthorization
  );
}

function validateStateBindings(document: CheckoutDocument): void {
  const orderRequired = new Set<CheckoutState>([
    CheckoutState.AWAITING_APPROVAL,
    CheckoutState.AUTHORIZE_REQUESTED,
    CheckoutState.RECONCILE_AUTHORIZE_UNKNOWN,
    CheckoutState.AUTHORIZED,
    CheckoutState.RESERVING,
    CheckoutState.RESERVED,
    CheckoutState.NEVER_CAPTURE_VOID_REQUESTED,
    CheckoutState.RECONCILE_VOID_UNKNOWN,
    CheckoutState.CAPTURE_REQUESTED,
    CheckoutState.RECONCILE_CAPTURE_UNKNOWN,
    CheckoutState.CONFIRMED_NON_CAPTURABLE,
    CheckoutState.CAPTURED_PENDING_COMMIT,
    CheckoutState.COMMITTING,
    CheckoutState.RECONCILE_CAPTURED,
    CheckoutState.COMPLETED,
    CheckoutState.VOIDED,
    CheckoutState.MANUAL_REVIEW_AWAITING_APPROVAL,
    CheckoutState.MANUAL_REVIEW_AUTHORIZE_UNKNOWN,
    CheckoutState.MANUAL_REVIEW_AUTHORIZED,
    CheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
    CheckoutState.MANUAL_REVIEW_CAPTURED,
  ]);
  assertProviderIdPresence(
    document.paypalOrderId,
    orderRequired.has(document.state),
    document.state === CheckoutState.EXPIRED,
    'order'
  );

  const authorizationRequired = new Set<CheckoutState>([
    CheckoutState.AUTHORIZED,
    CheckoutState.RESERVING,
    CheckoutState.RESERVED,
    CheckoutState.NEVER_CAPTURE_VOID_REQUESTED,
    CheckoutState.RECONCILE_VOID_UNKNOWN,
    CheckoutState.CAPTURE_REQUESTED,
    CheckoutState.RECONCILE_CAPTURE_UNKNOWN,
    CheckoutState.CONFIRMED_NON_CAPTURABLE,
    CheckoutState.CAPTURED_PENDING_COMMIT,
    CheckoutState.COMMITTING,
    CheckoutState.RECONCILE_CAPTURED,
    CheckoutState.COMPLETED,
    CheckoutState.VOIDED,
    CheckoutState.MANUAL_REVIEW_AUTHORIZED,
    CheckoutState.MANUAL_REVIEW_CAPTURE_UNKNOWN,
    CheckoutState.MANUAL_REVIEW_CAPTURED,
  ]);
  assertProviderIdPresence(
    document.paypalAuthorizationId,
    authorizationRequired.has(document.state),
    false,
    'authorization'
  );

  const captureRequired = new Set<CheckoutState>([
    CheckoutState.CAPTURED_PENDING_COMMIT,
    CheckoutState.COMMITTING,
    CheckoutState.RECONCILE_CAPTURED,
    CheckoutState.COMPLETED,
    CheckoutState.MANUAL_REVIEW_CAPTURED,
  ]);
  assertProviderIdPresence(
    document.paypalCaptureId,
    captureRequired.has(document.state),
    false,
    'capture'
  );
  if (document.state === CheckoutState.COMPLETED && document.receipt === null)
    throw corrupt('Completed state requires receipt.');
  if (document.receipt !== null && document.state !== CheckoutState.COMPLETED)
    throw corrupt('Receipt requires completed state.');
}

function assertProviderIdPresence(
  value: string | null,
  required: boolean,
  optional: boolean,
  providerFact: string
): void {
  if (required && value === null) throw corrupt(`State requires PayPal ${providerFact} id.`);
  if (!required && !optional && value !== null) {
    throw corrupt(`State forbids PayPal ${providerFact} id.`);
  }
}

function validateReceipt(value: unknown, document: CheckoutDocument): void {
  const receipt = exactRecord(
    value,
    ['transactionId', 'checkoutId', 'quote', 'paypalCaptureId', 'completedAt'],
    'receipt'
  );
  nonEmpty(receipt['transactionId'], 'receipt.transactionId');
  if (
    receipt['checkoutId'] !== document.id ||
    receipt['paypalCaptureId'] !== document.paypalCaptureId
  ) {
    throw corrupt('Receipt binding is invalid.');
  }
  const completed = canonicalUtcEpoch(receipt['completedAt'], 'receipt.completedAt');
  const created = canonicalUtcEpoch(document.createdAt, 'createdAt');
  const updated = canonicalUtcEpoch(document.updatedAt, 'updatedAt');
  if (completed < created || completed > updated) {
    throw corrupt('Receipt completedAt is outside the checkout lifetime.');
  }
  assertCheckoutQuote(receipt['quote']);
  if (!checkoutQuotesEqual(receipt['quote'], document.quote)) {
    throw corrupt('Receipt quote differs from checkout quote.');
  }
}

function validateFailure(value: unknown): void {
  const failure = exactRecord(value, ['code', 'at', 'retryable', 'detail'], 'failure');
  nonEmpty(failure['code'], 'failure.code');
  nonEmpty(failure['detail'], 'failure.detail');
  canonicalUtcEpoch(failure['at'], 'failure.at');
  if (typeof failure['retryable'] !== 'boolean') throw corrupt('Invalid failure.retryable.');
}

function validateClaim(document: IdempotencyClaimDocument): void {
  exactRecord(
    document,
    ['id', 'kind', 'keyHash', 'keyVersion', 'requestFingerprint', 'checkoutId', 'createdAt'],
    'claim'
  );
  if (document.kind !== 'checkout-idempotency-claim') throw corrupt('Invalid claim kind.');
  nonEmpty(document.keyHash, 'claim.keyHash');
  nonEmpty(document.keyVersion, 'claim.keyVersion');
  nonEmpty(document.requestFingerprint, 'claim.requestFingerprint');
  assertCheckoutIdNamespace(document.checkoutId);
  canonicalUtcEpoch(document.createdAt, 'claim.createdAt');
}

function validateBinding(document: ProviderBindingDocument): void {
  exactRecord(
    document,
    ['id', 'kind', 'referenceKind', 'referenceId', 'checkoutId', 'createdAt'],
    'provider binding'
  );
  if (document.kind !== 'checkout-provider-binding')
    throw corrupt('Invalid provider binding kind.');
  assertReferenceKind(document.referenceKind);
  nonEmpty(document.referenceId, 'binding.referenceId');
  assertCheckoutIdNamespace(document.checkoutId);
  canonicalUtcEpoch(document.createdAt, 'binding.createdAt');
}

function validateLeaseInput(input: {
  checkoutId: string;
  ownerId: string;
  leaseId: string;
  nowIso: string;
}): void {
  assertCheckoutIdNamespace(input.checkoutId);
  validateLeaseFence(input);
}

function validateLeaseFence(input: CheckoutLeaseFence): void {
  nonEmpty(input.ownerId, 'ownerId');
  nonEmpty(input.leaseId, 'leaseId');
  canonicalUtcEpoch(input.nowIso, 'nowIso');
}

function validateLease(value: unknown): void {
  const lease = exactRecord(value, ['ownerId', 'leaseId', 'expiresAt'], 'lease');
  nonEmpty(lease['ownerId'], 'lease.ownerId');
  nonEmpty(lease['leaseId'], 'lease.leaseId');
  canonicalUtcEpoch(lease['expiresAt'], 'lease.expiresAt');
}

function leaseOf(input: { ownerId: string; leaseId: string; expiresAtIso: string }): CheckoutLease {
  return { ownerId: input.ownerId, leaseId: input.leaseId, expiresAt: input.expiresAtIso };
}

function sameLease(left: CheckoutLease, right: CheckoutLease): boolean {
  return (
    left.ownerId === right.ownerId &&
    left.leaseId === right.leaseId &&
    left.expiresAt === right.expiresAt
  );
}

function validateDueCursor(value: unknown, asOf: string): asserts value is DueCheckoutCursor {
  const cursor = exactRecord(value, ['asOf', 'nextActionAt', 'checkoutId'], 'due cursor');
  if (cursor['asOf'] !== asOf) throw corrupt('Due reader cursor cutoff does not match.');
  canonicalUtcEpoch(cursor['nextActionAt'], 'cursor.nextActionAt');
  assertCheckoutIdNamespace(cursor['checkoutId']);
}

function compareCursor(left: DueCheckoutCursor, right: DueCheckoutCursor): number {
  const byTime = Date.parse(left.nextActionAt) - Date.parse(right.nextActionAt);
  return byTime || left.checkoutId.localeCompare(right.checkoutId);
}

function exactRecord(
  value: unknown,
  expectedKeys: readonly string[],
  label: string
): Record<string, unknown> {
  if (!isRecord(value)) throw corrupt(`${label} must be an object.`);
  const keys = Object.keys(value);
  if (keys.length !== expectedKeys.length || keys.some((key) => !expectedKeys.includes(key))) {
    throw corrupt(`${label} has an invalid shape.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertCheckoutIdNamespace(value: unknown): asserts value is string {
  nonEmpty(value, 'checkoutId');
  if ((value as string).startsWith('checkout-claim:'))
    throw new Error('Checkout id collides with a reserved namespace.');
}

function assertReferenceKind(value: unknown): asserts value is PayPalReferenceKind {
  if (value !== 'order' && value !== 'authorization' && value !== 'capture')
    throw new Error('Invalid provider reference kind.');
}

function safeDigest(value: string): string {
  nonEmpty(value, 'digest');
  if (!/^[A-Za-z0-9_-]+$/.test(value))
    throw new Error('Digest must use a document-id-safe alphabet.');
  return value;
}

function nonEmpty(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || value.length < 1 || value.length > 500)
    throw corrupt(`${label} is invalid.`);
}

function nullableNonEmpty(value: unknown, label: string): void {
  if (value !== null) nonEmpty(value, label);
}

function nonNegativeSafe(value: unknown, label: string): void {
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw corrupt(`${label} is invalid.`);
}

function canonicalUtcEpoch(value: unknown, label: string): number {
  if (typeof value !== 'string') throw corrupt(`${label} is invalid.`);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value)
    throw corrupt(`${label} is invalid.`);
  return epoch;
}

function corrupt(message: string): Error {
  return new Error(`Corrupt checkout data: ${message}`);
}
