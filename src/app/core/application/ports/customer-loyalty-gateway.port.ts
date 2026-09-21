import { InjectionToken } from '@angular/core';

export const CustomerLoyaltyTier = {
  BRONZE: 'bronze',
  SILVER: 'silver',
  GOLD: 'gold',
  PLATINUM: 'platinum',
} as const;

export type CustomerLoyaltyTier = (typeof CustomerLoyaltyTier)[keyof typeof CustomerLoyaltyTier];

export const CustomerLoyaltyStatus = {
  AVAILABLE: 'available',
  UNAVAILABLE: 'unavailable',
  MANUAL_REVIEW: 'manual-review',
} as const;

export type CustomerLoyaltyStatus =
  (typeof CustomerLoyaltyStatus)[keyof typeof CustomerLoyaltyStatus];

/** Customer-safe projection returned by the bearer-authenticated loyalty endpoint. */
export interface CustomerLoyaltyProjection {
  readonly status: CustomerLoyaltyStatus;
  readonly pointsBalance: number;
  readonly tier: CustomerLoyaltyTier;
  readonly policyVersion: 'self-checkout-usd-v1';
  readonly updatedAt: string;
}

export interface CustomerLoyaltyGateway {
  /** Read the current bearer subject's loyalty projection. No customer id is accepted. */
  read(accessToken: string): Promise<CustomerLoyaltyProjection>;
}

export const CUSTOMER_LOYALTY_GATEWAY = new InjectionToken<CustomerLoyaltyGateway>(
  'CUSTOMER_LOYALTY_GATEWAY'
);
