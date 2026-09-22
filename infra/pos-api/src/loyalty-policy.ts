export const SELF_CHECKOUT_LOYALTY_POLICY_VERSION = 'self-checkout-usd-v1' as const;

export type SelfCheckoutLoyaltyPolicyVersion = typeof SELF_CHECKOUT_LOYALTY_POLICY_VERSION;

export const LoyaltyTier = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD: 'gold',
  PLATINUM: 'platinum',
} as const;

export type LoyaltyTier = (typeof LoyaltyTier)[keyof typeof LoyaltyTier];

const POINTS_PER_WHOLE_USD = 10;
const SILVER_THRESHOLD = 1_000;
const GOLD_THRESHOLD = 5_000;
const PLATINUM_THRESHOLD = 10_000;

/**
 * V1 is deliberately checkout-only and order-independent. A customer's current
 * tier never changes what a concurrent checkout earns.
 */
export function pointsForSelfCheckout(totalMinorUnits: number): number {
  assertNonNegativeSafeInteger(totalMinorUnits, 'totalMinorUnits');
  const points = Math.floor(totalMinorUnits / 100) * POINTS_PER_WHOLE_USD;
  if (!Number.isSafeInteger(points)) {
    throw new Error('Loyalty points exceed the safe integer range.');
  }
  return points;
}

export function tierForLoyaltyBalance(pointsBalance: number): LoyaltyTier {
  assertNonNegativeSafeInteger(pointsBalance, 'pointsBalance');
  if (pointsBalance >= PLATINUM_THRESHOLD) return LoyaltyTier.PLATINUM;
  if (pointsBalance >= GOLD_THRESHOLD) return LoyaltyTier.GOLD;
  if (pointsBalance >= SILVER_THRESHOLD) return LoyaltyTier.SILVER;
  return LoyaltyTier.BRONZE;
}

export function isLoyaltyTier(value: unknown): value is LoyaltyTier {
  return typeof value === 'string' && Object.values(LoyaltyTier).includes(value as LoyaltyTier);
}

function assertNonNegativeSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}
