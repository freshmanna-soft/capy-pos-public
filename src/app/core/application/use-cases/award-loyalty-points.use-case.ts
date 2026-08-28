import { Injectable, inject } from '@angular/core';
import { ICustomerRepository } from '@core/domain/interfaces/customer.repository.interface';
import { CUSTOMER_REPOSITORY } from '@core/infrastructure/factories/repository.factory';
import { CustomerStatus, CustomerTier } from '@core/domain/entities/customer.entity';
import { LOYALTY_SERVICE } from '@core/domain/rules/loyalty.service.provider';
import { ILoyaltyService, LoyaltyTier } from '@core/domain/rules/loyalty.service.interface';

/**
 * What a completed sale needs in order to award points.
 */
export interface AwardLoyaltyPointsRequest {
  /** The customer attached to the sale. */
  customerId: string;
  /** What the customer paid, in currency units (i.e. the receipt total). */
  purchaseAmount: number;
}

/**
 * Why a sale awarded nothing.
 *
 * Every one of these is an ordinary outcome rather than a fault: a sale with no
 * card, a sub-unit amount, a card that no longer resolves, a blocked account, or
 * a write that failed. The caller logs them and completes the sale regardless.
 */
export type LoyaltyAwardSkipReason =
  | 'invalid-amount'
  | 'below-minimum-spend'
  | 'customer-not-found'
  | 'customer-blocked'
  | 'award-failed';

/**
 * Outcome of an award attempt.
 *
 * `previousTier` and `tier` are both populated on success so the caller can see a
 * promotion without re-reading the customer; they are equal when the sale did not
 * cross a threshold.
 */
export interface LoyaltyAwardResult {
  /** Whether points were actually written to the customer. */
  awarded: boolean;
  /** Points earned by this sale — 0 whenever nothing was written. */
  points: number;
  /** Balance after the award, or null when nothing was written. */
  balance: number | null;
  /** Tier before the award, or null when the customer was never read. */
  previousTier: CustomerTier | null;
  /** Tier after the award, or null when nothing was written. */
  tier: CustomerTier | null;
  /** Present only when `awarded` is false. */
  reason?: LoyaltyAwardSkipReason;
  /** The underlying failure message, for `award-failed` only. */
  error?: string;
}

/**
 * `CustomerTier` (entity) and `LoyaltyTier` (domain rules) are the same four-rung
 * ladder spelled twice, at the same thresholds. They are bridged explicitly rather
 * than cast across, because a cast would silently pass whatever a Dexie record
 * happens to hold — and those records are unvalidated — into a service that throws
 * on an unknown tier, turning a bad row into a lost sale.
 */
const LOYALTY_TIER_BY_CUSTOMER_TIER: Readonly<Record<string, LoyaltyTier>> = {
  [CustomerTier.BRONZE]: LoyaltyTier.BRONZE,
  [CustomerTier.SILVER]: LoyaltyTier.SILVER,
  [CustomerTier.GOLD]: LoyaltyTier.GOLD,
  [CustomerTier.PLATINUM]: LoyaltyTier.PLATINUM,
};

/**
 * Maps a stored customer tier onto the loyalty rules' tier.
 *
 * Falls back to BRONZE — the no-bonus rung — for anything unrecognised, so a
 * corrupt tier costs the customer their multiplier rather than costing them the
 * points entirely.
 */
export function toLoyaltyTier(tier: string): LoyaltyTier {
  return LOYALTY_TIER_BY_CUSTOMER_TIER[tier] ?? LoyaltyTier.BRONZE;
}

/**
 * Snaps a stored customer tier back onto the `CustomerTier` ladder.
 *
 * The same BRONZE fallback as `toLoyaltyTier`, applied to the other half of the
 * bridge. Both guards are needed and for the same reason: a Dexie tier is an
 * unvalidated string, and `LoyaltyAwardResult` declares `CustomerTier`. Guarding
 * only the multiplier lookup would let a raw value reach the caller, where
 * `PosFacade` reports a promotion by comparing the tier before with the tier
 * after — so a corrupt row would announce a promotion nobody earned.
 */
export function toCustomerTier(tier: string): CustomerTier {
  return tier in LOYALTY_TIER_BY_CUSTOMER_TIER ? (tier as CustomerTier) : CustomerTier.BRONZE;
}

/**
 * AwardLoyaltyPointsUseCase
 *
 * Awards loyalty points for a completed sale and lets the customer's tier be
 * recalculated from the new balance.
 *
 * Until this existed the loyalty programme was inert: `Customer.addPoints` and the
 * tier ladder were both implemented and tested, but nothing on the selling path
 * ever called them (#177).
 *
 * Two deliberate decisions:
 *
 * - **Rounding.** Points accrue per *whole* currency unit: the amount is floored
 *   before the rate is applied, so the pennies on a 12.99 sale earn nothing. The
 *   rate itself and the tier multipliers stay in `LoyaltyService`, which owns that
 *   policy — this use case decides only what counts as a unit.
 * - **No clawback on refund.** A refund does not remove points. There is no
 *   reversal path here for it to hook into (`Transaction.refund` is reachable only
 *   through `PaymentAgent`, never from the till), and silently draining a balance
 *   would be worse than a small over-accrual. When refunds grow a real workflow,
 *   they should post a compensating `redeemPoints` rather than mutate history.
 *
 * Clean Architecture: Application Layer Use Case
 * - Depends on: ICustomerRepository and ILoyaltyService (domain interfaces)
 * - Called by: PosFacade.checkout(), fire-and-forget
 *
 * @example
 * ```typescript
 * const result = await awardLoyaltyPoints.execute({
 *   customerId: 'c-1',
 *   purchaseAmount: receipt.total,
 * });
 * ```
 */
@Injectable({ providedIn: 'root' })
export class AwardLoyaltyPointsUseCase {
  private readonly customerRepository = inject<ICustomerRepository>(CUSTOMER_REPOSITORY);
  private readonly loyalty = inject<ILoyaltyService>(LOYALTY_SERVICE);

  /**
   * Awards the points earned by one sale.
   *
   * Never throws: every failure is reported as a result with `awarded: false`, so a
   * caller on the selling path cannot accidentally fail a paid-for sale by
   * awaiting this.
   *
   * @param request - The attached customer and what they paid
   * @returns The award outcome, including the tier before and after
   */
  async execute(request: AwardLoyaltyPointsRequest): Promise<LoyaltyAwardResult> {
    const { customerId, purchaseAmount } = request;

    if (!Number.isFinite(purchaseAmount) || purchaseAmount <= 0) {
      return this.nothing('invalid-amount');
    }

    // Rounding, decided above: whole currency units only.
    const wholeUnits = Math.floor(purchaseAmount);
    if (wholeUnits < 1) {
      return this.nothing('below-minimum-spend');
    }

    try {
      const customer = await this.customerRepository.findById(customerId);
      if (!customer) {
        return this.nothing('customer-not-found');
      }
      // Normalised once, ahead of every use: the multiplier lookup and the
      // before/after pair in the result must agree on what rung this customer was
      // on, and only one of them can be allowed to see a corrupt Dexie value.
      const previousTier = toCustomerTier(customer.tier);

      if (customer.status === CustomerStatus.BLOCKED) {
        // Checked here rather than left to `addPoints` to throw, so a blocked card
        // reads as a decision in the result instead of an error in the log.
        return { ...this.nothing('customer-blocked'), previousTier };
      }

      const { totalPoints } = this.loyalty.calculatePoints(wholeUnits, toLoyaltyTier(previousTier));

      if (totalPoints <= 0) {
        // Unreachable at the current rate, and guarded anyway: `addPoints` rejects a
        // non-positive award, so a future sub-point rate would otherwise turn every
        // small sale into a logged failure.
        return { ...this.nothing('below-minimum-spend'), previousTier };
      }

      // `updateLoyaltyPoints` re-reads the customer and applies `addPoints`, which
      // recalculates the tier and persists both. The tier read above is only used to
      // pick the multiplier, so a concurrent change cannot corrupt the stored
      // balance — at worst it prices this one sale at the previous tier.
      const updated = await this.customerRepository.updateLoyaltyPoints(customerId, totalPoints);

      return {
        awarded: true,
        points: totalPoints,
        balance: updated.loyaltyPoints,
        previousTier,
        tier: toCustomerTier(updated.tier),
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Failed to award loyalty points';
      return { ...this.nothing('award-failed'), error: message };
    }
  }

  /** An outcome that wrote nothing. */
  private nothing(reason: LoyaltyAwardSkipReason): LoyaltyAwardResult {
    return { awarded: false, points: 0, balance: null, previousTier: null, tier: null, reason };
  }
}
