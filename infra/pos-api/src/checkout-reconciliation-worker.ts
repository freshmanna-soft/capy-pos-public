import type { CheckoutReconcileResult, CheckoutReconciliationLease } from './checkout-service.ts';
import type { DueCheckoutCursor, DueCheckoutReader } from './checkout-store.ts';

export interface CheckoutReconciler {
  reconcile(
    checkoutId: string,
    lease: CheckoutReconciliationLease
  ): Promise<CheckoutReconcileResult>;
}

export interface CheckoutReconciliationWorkerDeps {
  readonly dueCheckouts: DueCheckoutReader;
  readonly reconciler: CheckoutReconciler;
  readonly ownerId: string;
  readonly nowIso: () => string;
  readonly newId: () => string;
}

export interface CheckoutReconciliationBatchOptions {
  readonly maxCheckouts: number;
  readonly pageSize: number;
}

export interface CheckoutReconciliationBatchResult {
  readonly asOf: string;
  readonly attempted: number;
  readonly reconciled: number;
  readonly busy: number;
  readonly failed: number;
  readonly exhausted: boolean;
}

const MAX_BATCH_SIZE = 1_000;
const MAX_PAGE_SIZE = 100;

/**
 * Processes a fixed due-time snapshot. The page and batch caps bound each invocation,
 * while checkout leases and idempotent reconciliation make overlapping jobs safe.
 */
export class CheckoutReconciliationWorker {
  private readonly deps: CheckoutReconciliationWorkerDeps;

  constructor(deps: CheckoutReconciliationWorkerDeps) {
    this.deps = deps;
    assertIdentifier(deps.ownerId, 'worker owner id');
  }

  async run(
    options: CheckoutReconciliationBatchOptions
  ): Promise<CheckoutReconciliationBatchResult> {
    assertPositiveInteger(options.maxCheckouts, MAX_BATCH_SIZE, 'maxCheckouts');
    assertPositiveInteger(options.pageSize, MAX_PAGE_SIZE, 'pageSize');

    const asOf = canonicalNow(this.deps.nowIso());
    let cursor: DueCheckoutCursor | undefined;
    let attempted = 0;
    let reconciled = 0;
    let busy = 0;
    let failed = 0;
    let exhausted = false;

    while (attempted < options.maxCheckouts) {
      const limit = Math.min(options.pageSize, options.maxCheckouts - attempted);
      const page = await this.deps.dueCheckouts.listDue({ asOf, limit, cursor });
      for (const checkout of page.checkouts) {
        attempted += 1;
        try {
          const result = await this.deps.reconciler.reconcile(checkout.id, {
            ownerId: this.deps.ownerId,
            leaseId: assertIdentifier(this.deps.newId(), 'lease id'),
          });
          if (result.outcome === 'busy') busy += 1;
          else reconciled += 1;
        } catch {
          failed += 1;
        }
      }

      cursor = page.nextCursor ?? undefined;
      if (cursor === undefined) break;
      if (attempted >= options.maxCheckouts) {
        exhausted = true;
        break;
      }
    }

    return { asOf, attempted, reconciled, busy, failed, exhausted };
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
