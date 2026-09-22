import { authenticateRequiredCustomer, type CustomerVerificationConfig } from './customer-auth.ts';
import type {
  CustomerProfileDocument,
  DurableCustomerIdentity,
  VersionedCustomerProfile,
} from './customer-profile-store.ts';
import {
  LoyaltyTier,
  SELF_CHECKOUT_LOYALTY_POLICY_VERSION,
  type SelfCheckoutLoyaltyPolicyVersion,
} from './loyalty-policy.ts';

export const CUSTOMER_LOYALTY_PATH = '/api/self-checkout/customer/loyalty';

export interface CustomerLoyaltyHttpRequest {
  readonly method: string;
  readonly path: string;
  readonly authorization: string | readonly string[] | undefined;
}

export interface CustomerLoyaltyHttpResponse {
  readonly status: number;
  readonly body: unknown;
}

export interface CustomerLoyaltyProfileReader {
  read(identity: DurableCustomerIdentity): Promise<VersionedCustomerProfile | null>;
}

export interface CustomerLoyaltyHttpDeps {
  readonly profiles: CustomerLoyaltyProfileReader;
  readonly customerAuth?: CustomerVerificationConfig;
  readonly nowSeconds: () => number;
  readonly nowIso: () => string;
}

export type PublicCustomerLoyaltyStatus = 'available' | 'unavailable' | 'manual-review';

export interface PublicCustomerLoyaltyProjection {
  readonly status: PublicCustomerLoyaltyStatus;
  readonly pointsBalance: number;
  readonly tier: CustomerProfileDocument['tier'];
  readonly policyVersion: SelfCheckoutLoyaltyPolicyVersion;
  readonly updatedAt: string;
}

/** Bearer-authenticated projection for the current subject; no customer id is accepted. */
export async function handleCustomerLoyaltyHttp(
  request: CustomerLoyaltyHttpRequest,
  deps: CustomerLoyaltyHttpDeps
): Promise<CustomerLoyaltyHttpResponse | null> {
  if (request.path !== CUSTOMER_LOYALTY_PATH || request.method.toUpperCase() !== 'GET') return null;

  const authenticated = await authenticateRequiredCustomer(
    optionalAuthorization(request.authorization),
    deps.customerAuth,
    deps.nowSeconds()
  );
  if (!authenticated.ok) {
    return { status: authenticated.status, body: { error: authenticated.error } };
  }

  try {
    const profile = await deps.profiles.read(authenticated.principal);
    return { status: 200, body: publicProjection(profile, deps.nowIso()) };
  } catch {
    return { status: 503, body: { error: 'Customer loyalty is unavailable.' } };
  }
}

function publicProjection(
  profile: VersionedCustomerProfile | null,
  nowIso: string
): PublicCustomerLoyaltyProjection {
  if (profile === null) {
    return {
      status: 'available',
      pointsBalance: 0,
      tier: LoyaltyTier.BRONZE,
      policyVersion: SELF_CHECKOUT_LOYALTY_POLICY_VERSION,
      updatedAt: canonicalTimestamp(nowIso),
    };
  }
  return {
    status:
      profile.document.status === 'active'
        ? 'available'
        : profile.document.status === 'rebuilding'
          ? 'unavailable'
          : 'manual-review',
    pointsBalance: profile.document.pointsBalance,
    tier: profile.document.tier,
    policyVersion: SELF_CHECKOUT_LOYALTY_POLICY_VERSION,
    updatedAt: profile.document.updatedAt,
  };
}

function optionalAuthorization(value: string | readonly string[] | undefined): string | undefined {
  if (value === undefined || typeof value === 'string') return value;
  return '';
}

function canonicalTimestamp(value: string): string {
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
    throw new Error('nowIso returned an invalid timestamp.');
  }
  return value;
}
