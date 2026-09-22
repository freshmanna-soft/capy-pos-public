import {
  CustomerLoyaltyService,
  LoyaltySettlementCorruptionError,
  type LoyaltySettlementInput,
  type LoyaltySettlementResult,
} from './customer-loyalty-service.ts';

export interface LoyaltyReconciliationLease {
  readonly ownerId: string;
  readonly leaseId: string;
}

export interface DueLoyaltyCursor {
  readonly asOf: string;
  readonly nextActionAt: string;
  readonly checkoutId: string;
}

export interface DueLoyaltyCheckout {
  readonly checkoutId: string;
  readonly settlement: LoyaltySettlementInput;
  readonly attempts: number;
}

export interface DueLoyaltyPage {
  readonly checkouts: readonly Readonly<{ id: string }>[];
  readonly nextCursor: DueLoyaltyCursor | null;
}

export interface DueLoyaltyReader {
  listDueLoyalty(input: {
    readonly asOf: string;
    readonly limit: number;
    readonly cursor?: DueLoyaltyCursor;
  }): Promise<DueLoyaltyPage>;
}

export type LoyaltyLeaseAcquireResult =
  | { readonly outcome: 'acquired' | 'replay'; readonly checkout: DueLoyaltyCheckout }
  | { readonly outcome: 'busy' | 'not-found' | 'not-pending' };

export type LoyaltyLeaseMutationResult = 'written' | 'lost' | 'not-found' | 'conflict';

/**
 * Checkout persistence owns this port. Every mutation changes only the embedded
 * loyalty projection on an already-completed checkout; financial state and its
 * payment lease/schedule are outside this interface by construction.
 */
export interface LoyaltyCheckoutRepository extends DueLoyaltyReader {
  tryAcquireLoyaltyLease(input: {
    readonly checkoutId: string;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly nowIso: string;
    readonly expiresAtIso: string;
  }): Promise<LoyaltyLeaseAcquireResult>;
  renewLoyaltyLease(input: {
    readonly checkoutId: string;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly nowIso: string;
    readonly expiresAtIso: string;
  }): Promise<LoyaltyLeaseMutationResult>;
  markLoyaltyAwarded(input: {
    readonly checkoutId: string;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly nowIso: string;
    readonly result: Extract<LoyaltySettlementResult, { readonly outcome: 'awarded' | 'replay' }>;
  }): Promise<LoyaltyLeaseMutationResult>;
  rescheduleLoyalty(input: {
    readonly checkoutId: string;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly nowIso: string;
    readonly nextActionAt: string;
    readonly attempts: number;
  }): Promise<LoyaltyLeaseMutationResult>;
  markLoyaltyManualReview(input: {
    readonly checkoutId: string;
    readonly ownerId: string;
    readonly leaseId: string;
    readonly nowIso: string;
    readonly attempts: number;
    readonly reason: 'profile-quarantined' | 'settlement-corruption';
  }): Promise<LoyaltyLeaseMutationResult>;
}

export type LoyaltyReconcileResult =
  | { readonly outcome: 'awarded' | 'rescheduled' | 'manual-review' }
  | { readonly outcome: 'busy' };

export class LoyaltyLeaseLostError extends Error {
  constructor() {
    super('Checkout loyalty lease was lost.');
    this.name = 'LoyaltyLeaseLostError';
  }
}

export interface LoyaltyReconcilerDeps {
  readonly checkouts: LoyaltyCheckoutRepository;
  readonly loyalty: Pick<CustomerLoyaltyService, 'settle'>;
  readonly nowIso: () => string;
  readonly leaseDurationMs?: number;
}

const DEFAULT_LEASE_DURATION_MS = 30_000;
const BASE_RETRY_MS = 5_000;
const MAX_RETRY_MS = 60 * 60 * 1_000;

export class LoyaltyReconciler {
  private readonly deps: LoyaltyReconcilerDeps;
  private readonly leaseDurationMs: number;

  constructor(deps: LoyaltyReconcilerDeps) {
    this.deps = deps;
    this.leaseDurationMs = deps.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    if (!Number.isSafeInteger(this.leaseDurationMs) || this.leaseDurationMs < 1) {
      throw new Error('Loyalty lease duration must be a positive integer.');
    }
  }

  async reconcile(
    checkoutId: string,
    lease: LoyaltyReconciliationLease
  ): Promise<LoyaltyReconcileResult> {
    assertIdentifier(checkoutId, 'checkoutId');
    assertIdentifier(lease.ownerId, 'lease owner');
    assertIdentifier(lease.leaseId, 'lease id');
    const acquiredAt = canonicalNow(this.deps.nowIso());
    const acquired = await this.deps.checkouts.tryAcquireLoyaltyLease({
      checkoutId,
      ...lease,
      nowIso: acquiredAt,
      expiresAtIso: addMilliseconds(acquiredAt, this.leaseDurationMs),
    });
    if (acquired.outcome === 'busy') return { outcome: 'busy' };
    if (acquired.outcome === 'not-found' || acquired.outcome === 'not-pending') {
      return { outcome: 'awarded' };
    }
    if (acquired.outcome !== 'acquired' && acquired.outcome !== 'replay') {
      throw new Error('Unexpected loyalty lease outcome.');
    }
    const heldCheckout = acquired.checkout;

    const fence = async (): Promise<void> => {
      const nowIso = canonicalNow(this.deps.nowIso());
      const renewed = await this.deps.checkouts.renewLoyaltyLease({
        checkoutId,
        ...lease,
        nowIso,
        expiresAtIso: addMilliseconds(nowIso, this.leaseDurationMs),
      });
      if (renewed !== 'written') throw new LoyaltyLeaseLostError();
    };

    try {
      const result = await this.deps.loyalty.settle(heldCheckout.settlement, {
        beforeMutation: fence,
      });
      if (result.outcome === 'awarded' || result.outcome === 'replay') {
        await fence();
        assertWritten(
          await this.deps.checkouts.markLoyaltyAwarded({
            checkoutId,
            ...lease,
            nowIso: canonicalNow(this.deps.nowIso()),
            result,
          })
        );
        return { outcome: 'awarded' };
      }
      if (result.outcome === 'quarantined') {
        await this.manualReview(
          checkoutId,
          lease,
          heldCheckout.attempts,
          'profile-quarantined',
          fence
        );
        return { outcome: 'manual-review' };
      }
      await this.reschedule(checkoutId, lease, heldCheckout.attempts, fence);
      return { outcome: 'rescheduled' };
    } catch (error) {
      if (error instanceof LoyaltyLeaseLostError) throw error;
      if (error instanceof LoyaltySettlementCorruptionError) {
        await this.manualReview(
          checkoutId,
          lease,
          heldCheckout.attempts,
          'settlement-corruption',
          fence
        );
        return { outcome: 'manual-review' };
      }
      await this.reschedule(checkoutId, lease, heldCheckout.attempts, fence);
      throw error;
    }
  }

  private async reschedule(
    checkoutId: string,
    lease: LoyaltyReconciliationLease,
    attempts: number,
    fence: () => Promise<void>
  ): Promise<void> {
    await fence();
    const nowIso = canonicalNow(this.deps.nowIso());
    assertWritten(
      await this.deps.checkouts.rescheduleLoyalty({
        checkoutId,
        ...lease,
        nowIso,
        nextActionAt: addMilliseconds(nowIso, retryDelay(attempts + 1)),
        attempts: attempts + 1,
      })
    );
  }

  private async manualReview(
    checkoutId: string,
    lease: LoyaltyReconciliationLease,
    attempts: number,
    reason: 'profile-quarantined' | 'settlement-corruption',
    fence: () => Promise<void>
  ): Promise<void> {
    await fence();
    assertWritten(
      await this.deps.checkouts.markLoyaltyManualReview({
        checkoutId,
        ...lease,
        nowIso: canonicalNow(this.deps.nowIso()),
        attempts: attempts + 1,
        reason,
      })
    );
  }
}

function assertWritten(outcome: LoyaltyLeaseMutationResult): void {
  if (outcome !== 'written') throw new LoyaltyLeaseLostError();
}

function retryDelay(attempt: number): number {
  const exponent = Math.max(0, Math.min(attempt - 1, 20));
  return Math.min(BASE_RETRY_MS * 2 ** exponent, MAX_RETRY_MS);
}

function addMilliseconds(value: string, milliseconds: number): string {
  return new Date(Date.parse(value) + milliseconds).toISOString();
}

function canonicalNow(value: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error('Loyalty reconciliation time must be a canonical UTC timestamp.');
  }
  return value;
}

function assertIdentifier(value: string, label: string): void {
  if (value.length < 1 || value.length > 500 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
}
