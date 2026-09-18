import type { CheckoutReconcileResult, CheckoutReconciliationLease } from './checkout-service.ts';
import type { DueCheckoutCursor, DueCheckoutReader } from './checkout-store.ts';

export interface CheckoutReconciler {
  reconcile(
    checkoutId: string,
    lease: CheckoutReconciliationLease
  ): Promise<CheckoutReconcileResult>;
}

export interface CheckoutReconciliationFailure {
  readonly checkoutId: string;
  readonly error: unknown;
}

export interface CheckoutReconciliationWorkerDeps {
  readonly dueCheckouts: DueCheckoutReader;
  readonly reconciler: CheckoutReconciler;
  readonly ownerId: string;
  readonly nowIso: () => string;
  readonly monotonicNowMs: () => number;
  readonly newId: () => string;
  readonly reportFailure: (failure: CheckoutReconciliationFailure) => void;
}

export interface CheckoutReconciliationBatchOptions {
  readonly maxCheckouts: number;
  readonly pageSize: number;
  readonly maxDurationMs: number;
}

export type CheckoutReconciliationExhaustionReason = 'count' | 'deadline' | null;

export interface CheckoutReconciliationBatchResult {
  readonly asOf: string;
  readonly attempted: number;
  readonly reconciled: number;
  readonly busy: number;
  readonly failed: number;
  readonly failureReportsDropped: number;
  readonly exhausted: boolean;
  readonly exhaustionReason: CheckoutReconciliationExhaustionReason;
}

const MAX_BATCH_SIZE = 1_000;
const MAX_PAGE_SIZE = 100;
const MAX_DURATION_MS = 15 * 60 * 1_000;

/**
 * Processes a fixed due-time snapshot. Page, batch, and wall-clock caps bound each
 * invocation, while checkout leases and idempotent reconciliation make overlaps safe.
 */
export class CheckoutReconciliationWorker {
  private readonly deps: CheckoutReconciliationWorkerDeps;

  constructor(deps: CheckoutReconciliationWorkerDeps) {
    this.deps = deps;
    assertIdentifier(deps.ownerId, 'worker owner id');
    if (typeof deps.reportFailure !== 'function') {
      throw new Error('Worker failure reporter is required.');
    }
  }

  async run(
    options: CheckoutReconciliationBatchOptions
  ): Promise<CheckoutReconciliationBatchResult> {
    assertPositiveInteger(options.maxCheckouts, MAX_BATCH_SIZE, 'maxCheckouts');
    assertPositiveInteger(options.pageSize, MAX_PAGE_SIZE, 'pageSize');
    assertPositiveInteger(options.maxDurationMs, MAX_DURATION_MS, 'maxDurationMs');

    const asOf = canonicalNow(this.deps.nowIso());
    const startedAtMs = monotonicNow(this.deps.monotonicNowMs());
    const deadlineMs = startedAtMs + options.maxDurationMs;
    let cursor: DueCheckoutCursor | undefined;
    let attempted = 0;
    let reconciled = 0;
    let busy = 0;
    let failed = 0;
    let failureReportsDropped = 0;
    let exhaustionReason: CheckoutReconciliationExhaustionReason = null;

    while (attempted < options.maxCheckouts) {
      if (this.deadlineReached(deadlineMs)) {
        exhaustionReason = 'deadline';
        break;
      }

      const limit = Math.min(options.pageSize, options.maxCheckouts - attempted);
      const page = await this.deps.dueCheckouts.listDue({ asOf, limit, cursor });
      for (const checkout of page.checkouts) {
        if (this.deadlineReached(deadlineMs)) {
          exhaustionReason = 'deadline';
          break;
        }

        attempted += 1;
        try {
          const result = await this.deps.reconciler.reconcile(checkout.id, {
            ownerId: this.deps.ownerId,
            leaseId: assertIdentifier(this.deps.newId(), 'lease id'),
          });
          if (result.outcome === 'busy') busy += 1;
          else reconciled += 1;
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
      reconciled,
      busy,
      failed,
      failureReportsDropped,
      exhausted: exhaustionReason !== null,
      exhaustionReason,
    };
  }

  private deadlineReached(deadlineMs: number): boolean {
    return monotonicNow(this.deps.monotonicNowMs()) >= deadlineMs;
  }
}

function assertPositiveInteger(value: number, maximum: number, label: string): void {
  if (!Number.isInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${label} must be between 1 and ${maximum}.`);
  }
}

function assertIdentifier(value: string, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 200 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function canonicalNow(value: string): string {
  if (typeof value !== 'string' || new Date(value).toISOString() !== value) {
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
