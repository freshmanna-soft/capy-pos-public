import type { DocumentStore } from '../../shared/src/document-store.ts';
import type { DurableCustomerIdentity } from './customer-profile-store.ts';
import {
  CHECKOUT_SCHEMA_VERSION_V2,
  type CheckoutDocument,
  type CheckoutLease,
  type CheckoutLoyaltyProjection,
  type CheckoutRepository,
  type CheckoutStoredDocument,
} from './checkout-store.ts';
import type {
  DueLoyaltyCursor,
  DueLoyaltyPage,
  DueLoyaltyReader,
  LoyaltyCheckoutRepository,
  LoyaltyLeaseAcquireResult,
  LoyaltyLeaseMutationResult,
} from './loyalty-reconciliation.ts';
import type { LoyaltySettlementResult } from './customer-loyalty-service.ts';

const MAX_LOYALTY_CAS_ATTEMPTS = 8;
const MAX_DUE_PAGE_SIZE = 100;

export class CheckoutLoyaltyStore implements LoyaltyCheckoutRepository {
  private readonly checkouts: CheckoutRepository;
  private readonly dueReader: DueLoyaltyReader;

  constructor(checkouts: CheckoutRepository, dueReader: DueLoyaltyReader) {
    this.checkouts = checkouts;
    this.dueReader = dueReader;
  }

  async listDueLoyalty(input: {
    readonly asOf: string;
    readonly limit: number;
    readonly cursor?: DueLoyaltyCursor;
  }): Promise<DueLoyaltyPage> {
    canonicalUtcEpoch(input.asOf, 'asOf');
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_DUE_PAGE_SIZE) {
      throw new Error(`limit must be between 1 and ${MAX_DUE_PAGE_SIZE}.`);
    }
    if (input.cursor !== undefined) {
      if (input.cursor.asOf !== input.asOf) throw new Error('Cursor cutoff does not match.');
      canonicalUtcEpoch(input.cursor.nextActionAt, 'cursor.nextActionAt');
      assertCheckoutId(input.cursor.checkoutId);
    }
    const page = await this.dueReader.listDueLoyalty(input);
    if (page.checkouts.length > input.limit)
      throw new Error('Due reader exceeded requested limit.');
    let previous = input.cursor;
    for (const checkout of page.checkouts) {
      const current = await this.checkouts.read(checkout.id);
      if (current === null) throw new Error('Loyalty due reader returned a missing checkout.');
      const dueAt = pendingLoyalty(current.document).nextActionAt;
      if (
        dueAt === null ||
        canonicalUtcEpoch(dueAt, 'loyalty.nextActionAt') > Date.parse(input.asOf)
      ) {
        throw new Error('Loyalty due reader returned a checkout outside the cutoff.');
      }
      const cursor = { asOf: input.asOf, nextActionAt: dueAt, checkoutId: current.document.id };
      if (previous !== undefined && compareCursor(previous, cursor) >= 0) {
        throw new Error('Loyalty due reader page is not strictly ordered.');
      }
      previous = cursor;
    }
    if (page.nextCursor !== null) {
      if (
        previous === undefined ||
        page.nextCursor.asOf !== input.asOf ||
        page.nextCursor.nextActionAt !== previous.nextActionAt ||
        page.nextCursor.checkoutId !== previous.checkoutId
      ) {
        throw new Error('Loyalty due reader cursor does not match the last checkout.');
      }
    }
    return page;
  }

  async tryAcquireLoyaltyLease(input: {
    readonly checkoutId: string;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly nowIso: string;
    readonly expiresAtIso: string;
  }): Promise<LoyaltyLeaseAcquireResult> {
    validateLeaseInput(input);
    const now = canonicalUtcEpoch(input.nowIso, 'nowIso');
    if (canonicalUtcEpoch(input.expiresAtIso, 'expiresAtIso') <= now) {
      throw new Error('Loyalty lease expiry must be after now.');
    }
    for (let attempt = 0; attempt < MAX_LOYALTY_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.checkouts.read(input.checkoutId);
      if (current === null) return { outcome: 'not-found' };
      if (current.document.state !== 'completed') return { outcome: 'not-pending' };
      const loyalty = current.document.loyalty;
      if (loyalty === undefined || loyalty.status !== 'pending') return { outcome: 'not-pending' };
      if (loyalty.lease !== null && Date.parse(loyalty.lease.expiresAt) > now) {
        if (loyalty.lease.ownerId === input.ownerId && loyalty.lease.leaseId === input.leaseId) {
          return { outcome: 'replay', checkout: settlementCheckout(current.document) };
        }
        return { outcome: 'busy' };
      }
      const next = replaceLoyalty(current.document, {
        ...loyalty,
        lease: leaseOf(input),
      });
      if (
        (await this.checkouts.compareAndSwap(input.checkoutId, next, current.revision)) !==
        'written'
      ) {
        continue;
      }
      const acquired = await this.checkouts.read(input.checkoutId);
      if (acquired === null) return { outcome: 'not-found' };
      return { outcome: 'acquired', checkout: settlementCheckout(acquired.document) };
    }
    return { outcome: 'busy' };
  }

  async renewLoyaltyLease(input: {
    readonly checkoutId: string;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly nowIso: string;
    readonly expiresAtIso: string;
  }): Promise<LoyaltyLeaseMutationResult> {
    validateLeaseInput(input);
    const now = canonicalUtcEpoch(input.nowIso, 'nowIso');
    if (canonicalUtcEpoch(input.expiresAtIso, 'expiresAtIso') <= now) {
      throw new Error('Loyalty lease expiry must be after now.');
    }
    return this.mutatePending(input, (loyalty) => ({ ...loyalty, lease: leaseOf(input) }));
  }

  async markLoyaltyAwarded(input: {
    readonly checkoutId: string;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly nowIso: string;
    readonly result: Extract<LoyaltySettlementResult, { readonly outcome: 'awarded' | 'replay' }>;
  }): Promise<LoyaltyLeaseMutationResult> {
    validateLeaseInput(input);
    return this.mutatePending(input, (loyalty) => {
      if (
        input.result.pointsEarned !== loyalty.pointsEarned ||
        input.result.policyVersion !== loyalty.policyVersion
      ) {
        throw new Error('Loyalty settlement result does not match the checkout obligation.');
      }
      return { ...loyalty, status: 'awarded', nextActionAt: null, lease: null };
    });
  }

  async rescheduleLoyalty(input: {
    readonly checkoutId: string;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly nowIso: string;
    readonly nextActionAt: string;
    readonly attempts: number;
  }): Promise<LoyaltyLeaseMutationResult> {
    validateLeaseInput(input);
    canonicalUtcEpoch(input.nextActionAt, 'nextActionAt');
    assertNonNegativeInteger(input.attempts, 'attempts');
    return this.mutatePending(input, (loyalty) => ({
      ...loyalty,
      nextActionAt: input.nextActionAt,
      attempts: input.attempts,
      lease: null,
    }));
  }

  async markLoyaltyManualReview(input: {
    readonly checkoutId: string;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly nowIso: string;
    readonly attempts: number;
    readonly reason: 'profile-quarantined' | 'settlement-corruption';
  }): Promise<LoyaltyLeaseMutationResult> {
    validateLeaseInput(input);
    assertNonNegativeInteger(input.attempts, 'attempts');
    if (!['profile-quarantined', 'settlement-corruption'].includes(input.reason)) {
      throw new Error('Invalid loyalty manual-review reason.');
    }
    return this.mutatePending(input, (loyalty) => ({
      ...loyalty,
      status: 'manual-review',
      nextActionAt: null,
      attempts: input.attempts,
      lease: null,
    }));
  }

  private async mutatePending(
    input: {
      readonly checkoutId: string;
      readonly ownerId: string;
      readonly leaseId: string;
      readonly nowIso: string;
    },
    mutate: (
      loyalty: Exclude<CheckoutLoyaltyProjection, { readonly status: 'not-applicable' }>
    ) => CheckoutLoyaltyProjection
  ): Promise<LoyaltyLeaseMutationResult> {
    const now = canonicalUtcEpoch(input.nowIso, 'nowIso');
    for (let attempt = 0; attempt < MAX_LOYALTY_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.checkouts.read(input.checkoutId);
      if (current === null) return 'not-found';
      const loyalty = current.document.loyalty;
      if (loyalty === undefined || loyalty.status !== 'pending') return 'lost';
      if (!holdsLease(loyalty.lease, input, now)) return 'lost';
      const next = replaceLoyalty(current.document, mutate(loyalty));
      if (
        (await this.checkouts.compareAndSwap(input.checkoutId, next, current.revision)) ===
        'written'
      ) {
        return 'written';
      }
    }
    return 'conflict';
  }
}

export class MemoryDueLoyaltyReader implements DueLoyaltyReader {
  private readonly documents: DocumentStore<CheckoutStoredDocument>;

  constructor(documents: DocumentStore<CheckoutStoredDocument>) {
    this.documents = documents;
  }

  async listDueLoyalty(input: {
    readonly asOf: string;
    readonly limit: number;
    readonly cursor?: DueLoyaltyCursor;
  }): Promise<DueLoyaltyPage> {
    const asOf = canonicalUtcEpoch(input.asOf, 'asOf');
    const cursorEpoch = input.cursor
      ? canonicalUtcEpoch(input.cursor.nextActionAt, 'cursor.nextActionAt')
      : null;
    const due = (await this.documents.list())
      .filter((document): document is CheckoutDocument => document.kind === 'checkout')
      .filter((document) => document.schemaVersion === CHECKOUT_SCHEMA_VERSION_V2)
      .flatMap((document) => {
        const loyalty = document.loyalty;
        if (document.state !== 'completed' || loyalty?.status !== 'pending') return [];
        const epoch = loyalty.nextActionAt === null ? null : Date.parse(loyalty.nextActionAt);
        return epoch === null || !Number.isFinite(epoch) ? [] : [{ document, epoch }];
      })
      .filter((entry) => entry.epoch <= asOf)
      .filter(
        (entry) =>
          input.cursor === undefined ||
          entry.epoch > cursorEpoch! ||
          (entry.epoch === cursorEpoch && entry.document.id > input.cursor.checkoutId)
      )
      .sort((a, b) => a.epoch - b.epoch || a.document.id.localeCompare(b.document.id));
    const selected = due.slice(0, input.limit);
    const last = selected.at(-1);
    return {
      checkouts: selected.map(({ document }) => ({ id: document.id })),
      nextCursor:
        due.length > selected.length && last && last.document.loyalty?.status === 'pending'
          ? {
              asOf: input.asOf,
              nextActionAt: last.document.loyalty.nextActionAt!,
              checkoutId: last.document.id,
            }
          : null,
    };
  }
}

function settlementCheckout(document: CheckoutDocument) {
  const loyalty = pendingLoyalty(document);
  if (document.customerBinding?.kind !== 'customer' || document.receipt === null) {
    throw new Error('Pending loyalty checkout has no customer or financial receipt binding.');
  }
  if (document.customerBinding.customerKey !== loyalty.customerKey) {
    throw new Error('Pending loyalty customer key differs from checkout ownership.');
  }
  const identity: DurableCustomerIdentity = {
    issuer: document.customerBinding.issuer,
    subject: document.customerBinding.subject,
    tenantId: document.customerBinding.tenantId,
    customerKey: document.customerBinding.customerKey,
    keyVersion: document.customerBinding.keyVersion,
  };
  return {
    checkoutId: document.id,
    settlement: {
      identity,
      checkoutId: document.id,
      transactionId: document.receipt.transactionId,
      storeId: document.storeId,
      currency: document.quote.currency,
      totalMinorUnits: document.quote.totalMinorUnits,
    },
    attempts: loyalty.attempts,
  } as const;
}

function pendingLoyalty(
  document: CheckoutDocument
): Exclude<CheckoutLoyaltyProjection, { readonly status: 'not-applicable' }> {
  if (
    document.schemaVersion !== CHECKOUT_SCHEMA_VERSION_V2 ||
    document.state !== 'completed' ||
    document.loyalty?.status !== 'pending'
  ) {
    throw new Error('Checkout does not contain a pending completed loyalty obligation.');
  }
  return document.loyalty;
}

function replaceLoyalty(
  document: CheckoutDocument,
  loyalty: CheckoutLoyaltyProjection
): CheckoutDocument {
  if (document.schemaVersion !== CHECKOUT_SCHEMA_VERSION_V2) {
    throw new Error('Loyalty mutations require a V2 checkout.');
  }
  return { ...document, loyalty };
}

function holdsLease(
  lease: CheckoutLease | null,
  input: { readonly ownerId: string; readonly leaseId: string },
  now: number
): boolean {
  return (
    lease !== null &&
    lease.ownerId === input.ownerId &&
    lease.leaseId === input.leaseId &&
    Date.parse(lease.expiresAt) > now
  );
}

function leaseOf(input: {
  readonly ownerId: string;
  readonly leaseId: string;
  readonly expiresAtIso: string;
}): CheckoutLease {
  return { ownerId: input.ownerId, leaseId: input.leaseId, expiresAt: input.expiresAtIso };
}

function validateLeaseInput(input: {
  readonly checkoutId: string;
  readonly ownerId: string;
  readonly leaseId: string;
  readonly nowIso: string;
}): void {
  assertCheckoutId(input.checkoutId);
  assertIdentifier(input.ownerId, 'ownerId');
  assertIdentifier(input.leaseId, 'leaseId');
  canonicalUtcEpoch(input.nowIso, 'nowIso');
}

function compareCursor(left: DueLoyaltyCursor, right: DueLoyaltyCursor): number {
  return (
    Date.parse(left.nextActionAt) - Date.parse(right.nextActionAt) ||
    left.checkoutId.localeCompare(right.checkoutId)
  );
}

function assertCheckoutId(value: string): void {
  assertIdentifier(value, 'checkoutId');
  if (value.startsWith('checkout-claim:')) throw new Error('checkoutId is invalid.');
}

function assertIdentifier(value: string, label: string): void {
  if (value.length < 1 || value.length > 500 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} is invalid.`);
}

function canonicalUtcEpoch(value: string, label: string): number {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error(`${label} is invalid.`);
  }
  return epoch;
}
