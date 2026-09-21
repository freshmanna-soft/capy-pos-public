import type { CustomerLoyaltyService } from './customer-loyalty-service.ts';
import { LoyaltyReconciler, type LoyaltyCheckoutRepository } from './loyalty-reconciliation.ts';

export interface LoyaltyReconciliationRuntime {
  readonly dueCheckouts: LoyaltyCheckoutRepository;
  readonly reconciler: LoyaltyReconciler;
}

/**
 * Persistence assembly seam. The checkout adapter implements only embedded-loyalty
 * operations; it cannot transition payment state or alter a financial receipt.
 */
export function buildLoyaltyReconciliationRuntime(input: {
  readonly checkouts: LoyaltyCheckoutRepository;
  readonly loyalty: Pick<CustomerLoyaltyService, 'settle'>;
  readonly nowIso: () => string;
  readonly leaseDurationMs?: number;
}): LoyaltyReconciliationRuntime {
  return {
    dueCheckouts: input.checkouts,
    reconciler: new LoyaltyReconciler({
      checkouts: input.checkouts,
      loyalty: input.loyalty,
      nowIso: input.nowIso,
      ...(input.leaseDurationMs === undefined ? {} : { leaseDurationMs: input.leaseDurationMs }),
    }),
  };
}
