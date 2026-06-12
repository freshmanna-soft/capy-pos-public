/**
 * Loyalty Service Interface
 *
 * Defines the contract for customer loyalty program operations including
 * points calculation, rewards management, and tier progression.
 *
 * @interface ILoyaltyService
 */

/**
 * Loyalty tier levels
 */
export enum LoyaltyTier {
  BRONZE = 'BRONZE',
  SILVER = 'SILVER',
  GOLD = 'GOLD',
  PLATINUM = 'PLATINUM',
}

/**
 * Loyalty tier configuration
 */
export interface TierConfig {
  tier: LoyaltyTier;
  minPoints: number;
  pointsMultiplier: number;
  discountPercentage: number;
}

/**
 * Points calculation result
 */
export interface PointsCalculation {
  basePoints: number;
  bonusPoints: number;
  totalPoints: number;
  multiplier: number;
}

/**
 * Reward redemption details
 */
export interface RewardRedemption {
  rewardId: string;
  pointsCost: number;
  customerId: string;
  redeemedAt: Date;
  expiresAt: Date | null;
}

/**
 * Tier progression result
 */
export interface TierProgression {
  currentTier: LoyaltyTier;
  currentPoints: number;
  nextTier: LoyaltyTier | null;
  pointsToNextTier: number;
  progressPercentage: number;
}

/**
 * Points transaction record
 */
export interface PointsTransaction {
  customerId: string;
  points: number;
  type: 'EARNED' | 'REDEEMED' | 'EXPIRED' | 'ADJUSTED';
  reason: string;
  transactionDate: Date;
  balanceAfter: number;
}

/**
 * Loyalty Service Interface
 *
 * Provides methods for managing customer loyalty programs including
 * points calculation, tier management, and reward redemption.
 */
export interface ILoyaltyService {
  /**
   * Calculate loyalty points earned from a purchase
   *
   * @param purchaseAmount - The purchase amount in base currency
   * @param currentTier - The customer's current loyalty tier
   * @param isSpecialPromotion - Whether special promotion multiplier applies
   * @returns Points calculation details
   * @throws Error if purchase amount is negative or tier is invalid
   */
  calculatePoints(
    purchaseAmount: number,
    currentTier: LoyaltyTier,
    isSpecialPromotion?: boolean
  ): PointsCalculation;

  /**
   * Determine loyalty tier based on total points
   *
   * @param totalPoints - The customer's total accumulated points
   * @returns The appropriate loyalty tier
   * @throws Error if total points is negative
   */
  determineTier(totalPoints: number): LoyaltyTier;

  /**
   * Get tier configuration details
   *
   * @param tier - The loyalty tier to get configuration for
   * @returns Tier configuration including thresholds and benefits
   */
  getTierConfig(tier: LoyaltyTier): TierConfig;

  /**
   * Calculate tier progression details
   *
   * @param currentPoints - The customer's current point balance
   * @returns Tier progression information
   * @throws Error if current points is negative
   */
  calculateTierProgression(currentPoints: number): TierProgression;

  /**
   * Redeem points for a reward
   *
   * @param customerId - The customer identifier
   * @param rewardId - The reward identifier
   * @param pointsCost - The cost in points
   * @param currentBalance - The customer's current point balance
   * @param expirationDays - Days until reward expires (null for no expiration)
   * @returns Reward redemption details
   * @throws Error if insufficient points or invalid parameters
   */
  redeemReward(
    customerId: string,
    rewardId: string,
    pointsCost: number,
    currentBalance: number,
    expirationDays?: number | null
  ): RewardRedemption;

  /**
   * Record a points transaction
   *
   * @param customerId - The customer identifier
   * @param points - The points amount (positive for earned, negative for redeemed)
   * @param type - The transaction type
   * @param reason - The reason for the transaction
   * @param currentBalance - The customer's current point balance
   * @returns Points transaction record
   * @throws Error if invalid parameters
   */
  recordTransaction(
    customerId: string,
    points: number,
    type: 'EARNED' | 'REDEEMED' | 'EXPIRED' | 'ADJUSTED',
    reason: string,
    currentBalance: number
  ): PointsTransaction;

  /**
   * Calculate discount amount based on tier
   *
   * @param amount - The purchase amount
   * @param tier - The customer's loyalty tier
   * @returns The discount amount
   * @throws Error if amount is negative
   */
  calculateTierDiscount(amount: number, tier: LoyaltyTier): number;

  /**
   * Check if customer has sufficient points for redemption
   *
   * @param currentBalance - The customer's current point balance
   * @param requiredPoints - The points required for redemption
   * @returns True if sufficient points available
   * @throws Error if values are negative
   */
  hasSufficientPoints(currentBalance: number, requiredPoints: number): boolean;
}

// Made with Bob
