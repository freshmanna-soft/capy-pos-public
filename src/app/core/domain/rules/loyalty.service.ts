import { Injectable } from '@angular/core';
import { BaseDomainService } from '@core/domain/rules/base-domain.service';
import {
  ILoyaltyService,
  LoyaltyTier,
  TierConfig,
  PointsCalculation,
  RewardRedemption,
  TierProgression,
  PointsTransaction,
} from '@core/domain/rules/loyalty.service.interface';

/**
 * Loyalty Service Implementation
 *
 * Implements customer loyalty program operations including points calculation,
 * tier management, and reward redemption.
 *
 * @class LoyaltyService
 * @extends BaseDomainService
 * @implements ILoyaltyService
 */
@Injectable({ providedIn: 'root' })
export class LoyaltyService extends BaseDomainService implements ILoyaltyService {
  /**
   * Tier configurations with thresholds and benefits
   */
  private readonly tierConfigs = new Map<LoyaltyTier, TierConfig>([
    [
      LoyaltyTier.BRONZE,
      {
        tier: LoyaltyTier.BRONZE,
        minPoints: 0,
        pointsMultiplier: 1,
        discountPercentage: 0,
      },
    ],
    [
      LoyaltyTier.SILVER,
      {
        tier: LoyaltyTier.SILVER,
        minPoints: 1000,
        pointsMultiplier: 1.25,
        discountPercentage: 5,
      },
    ],
    [
      LoyaltyTier.GOLD,
      {
        tier: LoyaltyTier.GOLD,
        minPoints: 5000,
        pointsMultiplier: 1.5,
        discountPercentage: 10,
      },
    ],
    [
      LoyaltyTier.PLATINUM,
      {
        tier: LoyaltyTier.PLATINUM,
        minPoints: 10000,
        pointsMultiplier: 2,
        discountPercentage: 15,
      },
    ],
  ]);

  /**
   * Base points per dollar spent
   */
  private readonly BASE_POINTS_PER_DOLLAR = 10;

  /**
   * Special promotion multiplier
   */
  private readonly PROMOTION_MULTIPLIER = 1.5;

  constructor() {
    super('LoyaltyService');
  }

  /**
   * Calculate loyalty points earned from a purchase
   */
  calculatePoints(
    purchaseAmount: number,
    currentTier: LoyaltyTier,
    isSpecialPromotion = false
  ): PointsCalculation {
    this.validateNonNegative(purchaseAmount, 'Purchase amount');

    const tierConfig = this.getTierConfig(currentTier);
    const basePoints = Math.floor(purchaseAmount * this.BASE_POINTS_PER_DOLLAR);
    const tierMultiplier = tierConfig.pointsMultiplier;
    const promotionMultiplier = isSpecialPromotion ? this.PROMOTION_MULTIPLIER : 1;
    const totalMultiplier = tierMultiplier * promotionMultiplier;

    const bonusPoints = Math.floor(basePoints * (totalMultiplier - 1));
    const totalPoints = basePoints + bonusPoints;

    return {
      basePoints,
      bonusPoints,
      totalPoints,
      multiplier: totalMultiplier,
    };
  }

  /**
   * Determine loyalty tier based on total points
   */
  determineTier(totalPoints: number): LoyaltyTier {
    this.validateNonNegative(totalPoints, 'Total points');

    if (totalPoints >= this.tierConfigs.get(LoyaltyTier.PLATINUM)!.minPoints) {
      return LoyaltyTier.PLATINUM;
    } else if (totalPoints >= this.tierConfigs.get(LoyaltyTier.GOLD)!.minPoints) {
      return LoyaltyTier.GOLD;
    } else if (totalPoints >= this.tierConfigs.get(LoyaltyTier.SILVER)!.minPoints) {
      return LoyaltyTier.SILVER;
    }
    return LoyaltyTier.BRONZE;
  }

  /**
   * Get tier configuration details
   */
  getTierConfig(tier: LoyaltyTier): TierConfig {
    const config = this.tierConfigs.get(tier);
    if (!config) {
      throw new Error(`[${this.serviceName}] Invalid loyalty tier: ${tier}`);
    }
    return { ...config };
  }

  /**
   * Calculate tier progression details
   */
  calculateTierProgression(currentPoints: number): TierProgression {
    this.validateNonNegative(currentPoints, 'Current points');

    const currentTier = this.determineTier(currentPoints);
    const tiers = [LoyaltyTier.BRONZE, LoyaltyTier.SILVER, LoyaltyTier.GOLD, LoyaltyTier.PLATINUM];
    const currentTierIndex = tiers.indexOf(currentTier);

    let nextTier: LoyaltyTier | null = null;
    let pointsToNextTier = 0;
    let progressPercentage = 100;

    if (currentTierIndex < tiers.length - 1) {
      nextTier = tiers[currentTierIndex + 1];
      const nextTierConfig = this.getTierConfig(nextTier);
      const currentTierConfig = this.getTierConfig(currentTier);

      pointsToNextTier = nextTierConfig.minPoints - currentPoints;
      const tierRange = nextTierConfig.minPoints - currentTierConfig.minPoints;
      const pointsInTier = currentPoints - currentTierConfig.minPoints;
      progressPercentage = Math.floor((pointsInTier / tierRange) * 100);
    }

    return {
      currentTier,
      currentPoints,
      nextTier,
      pointsToNextTier,
      progressPercentage,
    };
  }

  /**
   * Redeem points for a reward
   */
  redeemReward(
    customerId: string,
    rewardId: string,
    pointsCost: number,
    currentBalance: number,
    expirationDays: number | null = null
  ): RewardRedemption {
    this.validateRequired(customerId, 'Customer ID');
    this.validateRequired(rewardId, 'Reward ID');
    this.validatePositive(pointsCost, 'Points cost');
    this.validateNonNegative(currentBalance, 'Current balance');

    if (!this.hasSufficientPoints(currentBalance, pointsCost)) {
      throw new Error(
        `[${this.serviceName}] Insufficient points. ` +
          `Required: ${pointsCost}, Available: ${currentBalance}`
      );
    }

    if (expirationDays !== null && expirationDays !== undefined) {
      this.validatePositive(expirationDays, 'Expiration days');
    }

    const redeemedAt = new Date();
    const expiresAt = expirationDays
      ? new Date(redeemedAt.getTime() + expirationDays * 24 * 60 * 60 * 1000)
      : null;

    return {
      rewardId,
      pointsCost,
      customerId,
      redeemedAt,
      expiresAt,
    };
  }

  /**
   * Record a points transaction
   */
  recordTransaction(
    customerId: string,
    points: number,
    type: 'EARNED' | 'REDEEMED' | 'EXPIRED' | 'ADJUSTED',
    reason: string,
    currentBalance: number
  ): PointsTransaction {
    this.validateRequired(customerId, 'Customer ID');
    this.validateRequired(reason, 'Reason');
    this.validateNonNegative(currentBalance, 'Current balance');

    // Validate points based on transaction type
    if (type === 'EARNED' || type === 'ADJUSTED') {
      // Can be positive or negative for adjustments
    } else if (type === 'REDEEMED' || type === 'EXPIRED') {
      this.validatePositive(Math.abs(points), 'Points');
      if (points > 0) {
        throw new Error(`[${this.serviceName}] Points for ${type} transactions must be negative`);
      }
    }

    const balanceAfter = currentBalance + points;
    if (balanceAfter < 0) {
      throw new Error(
        `[${this.serviceName}] Transaction would result in negative balance. ` +
          `Current: ${currentBalance}, Change: ${points}, Result: ${balanceAfter}`
      );
    }

    return {
      customerId,
      points,
      type,
      reason,
      transactionDate: new Date(),
      balanceAfter,
    };
  }

  /**
   * Calculate discount amount based on tier
   */
  calculateTierDiscount(amount: number, tier: LoyaltyTier): number {
    this.validateNonNegative(amount, 'Amount');

    const tierConfig = this.getTierConfig(tier);
    return Math.floor(amount * (tierConfig.discountPercentage / 100) * 100) / 100;
  }

  /**
   * Check if customer has sufficient points for redemption
   */
  hasSufficientPoints(currentBalance: number, requiredPoints: number): boolean {
    this.validateNonNegative(currentBalance, 'Current balance');
    this.validateNonNegative(requiredPoints, 'Required points');

    return currentBalance >= requiredPoints;
  }
}

// Made with Bob
