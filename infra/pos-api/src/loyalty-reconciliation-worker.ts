import type {
  DueLoyaltyCursor,
  DueLoyaltyReader,
  LoyaltyReconcileResult,
  LoyaltyReconciliationLease,
} from './loyalty-reconciliation.ts';

export interface LoyaltyCheckoutReconciler {
  reconcile(checkoutId: string, lease: LoyaltyReconciliationLease): Promise<LoyaltyReconcileResult>;
}

export interface LoyaltyReconciliationFailure {
  readonly checkoutId: string;
  readonly error: unknown;
}

export interface LoyaltyReconciliationWorkerDeps {
  readonly dueCheckouts: DueLoyaltyReader;
  readonly reconciler: LoyaltyCheckoutReconciler;
  readonly ownerId: string;
  readonly nowIso: () => string;
  readonly monotonicNowMs: () => number;
  readonly newId: () => string;
  readonly reportFailure: (failure: LoyaltyReconciliationFailure) => void;
}

export interface LoyaltyReconciliationBatchOptions {
  readonly maxCheckouts: number;
  readonly pageSize: number;
  readonly maxDurationMs: number;
}

export interface LoyaltyReconciliationBatchResult {
  readonly asOf: string;
  readonly attempted: number;
  readonly awarded: number;
  readonly rescheduled: number;
  readonly manualReview: number;
  readonly busy: number;
  readonly failed: number;
  readonly failureReportsDropped: number;
  readonly exhausted: boolean;
  readonly exhaustionReason: 'count' | 'deadline' | null;
}

const MAX_BATCH_SIZE = 1_000;
const MAX_PAGE_SIZE = 100;
const MAX_DURATION_MS = 15 * 60 * 1_000;

/** Runs loyalty independently from payment reconciliation over one bounded due snapshot. */
export class LoyaltyReconciliationWorker {
  private readonly deps: LoyaltyReconciliationWorkerDeps;

  constructor(deps: LoyaltyReconciliationWorkerDeps) {
    this.deps = deps;
    assertIdentifier(deps.ownerId, 'worker owner id');
  }

  async run(options: LoyaltyReconciliationBatchOptions): Promise<LoyaltyReconciliationBatchResult> {
    assertPositiveInteger(options.maxCheckouts, MAX_BATCH_SIZE, 'maxCheckouts');
    assertPositiveInteger(options.pageSize, MAX_PAGE_SIZE, 'pageSize');
    assertPositiveInteger(options.maxDurationMs, MAX_DURATION_MS, 'maxDurationMs');
    const asOf = canonicalNow(this.deps.nowIso());
    const deadline = monotonicNow(this.deps.monotonicNowMs()) + options.maxDurationMs;
    let cursor: DueLoyaltyCursor | undefined;
    let attempted = 0;
    let awarded = 0;
    let rescheduled = 0;
    let manualReview = 0;
    let busy = 0;
    let failed = 0;
    let failureReportsDropped = 0;
    let exhaustionReason: 'count' | 'deadline' | null = null;

    while (attempted < options.maxCheckouts) {
      if (this.deadlineReached(deadline)) {
        exhaustionReason = 'deadline';
        break;
      }
      const limit = Math.min(options.pageSize, options.maxCheckouts - attempted);
      const page = await this.deps.dueCheckouts.listDueLoyalty({ asOf, limit, cursor });
      for (const checkout of page.checkouts) {
        if (this.deadlineReached(deadline)) {
          exhaustionReason = 'deadline';
          break;
        }
        attempted += 1;
        try {
          const result = await this.deps.reconciler.reconcile(checkout.id, {
            ownerId: this.deps.ownerId,
            leaseId: assertIdentifier(this.deps.newId(), 'lease id'),
          });
          switch (result.outcome) {
            case 'awarded':
              awarded += 1;
              break;
            case 'rescheduled':
              rescheduled += 1;
              break;
            case 'manual-review':
              manualReview += 1;
              break;
            case 'busy':
              busy += 1;
              break;
          }
        } catch (error) {
          failed += 1;
          try {
            this.deps.reportFailure({ checkoutId: checkout.id, error });
          } catch {
            failureReportsDropped += 1;
          }
        }
      }
      if (exhaustionReason === 'deadline') break;
      cursor = page.nextCursor ?? undefined;
      if (cursor === undefined) break;
      if (attempted >= options.maxCheckouts) {
        exhaustionReason = 'count';
        break;
      }
    }

    return {
      asOf,
      attempted,
      awarded,
      rescheduled,
      manualReview,
      busy,
      failed,
      failureReportsDropped,
      exhausted: exhaustionReason !== null,
      exhaustionReason,
    };
  }

  private deadlineReached(deadline: number): boolean {
    return monotonicNow(this.deps.monotonicNowMs()) >= deadline;
  }
}

function assertPositiveInteger(value: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be between 1 and ${maximum}.`);
  }
}

function assertIdentifier(value: string, label: string): string {
  if (value.length < 1 || value.length > 500 || /[\x00-\x1f\x7f]/.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function canonicalNow(value: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error('Worker time must be a canonical UTC timestamp.');
  }
  return value;
}

function monotonicNow(value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error('Worker monotonic time must be a non-negative finite number.');
  }
  return value;
}
