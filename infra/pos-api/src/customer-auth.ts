import { createHash } from 'node:crypto';
import { appIdIssuer, verifyAppIdJwt, type AppIdJwtVerificationConfig } from './appid-jwt.ts';
import { readBearer } from './session-auth.ts';

const DEFAULT_TENANT_ID = 'default-tenant';
const CUSTOMER_SCOPE = 'customer';
const CUSTOMER_KEY_VERSION = 'sha256-v1';

export interface CustomerVerificationConfig extends AppIdJwtVerificationConfig {
  readonly capyTenantId?: string;
}

export interface CustomerPrincipal {
  readonly issuer: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly customerKey: string;
  readonly keyVersion: typeof CUSTOMER_KEY_VERSION;
}

export type OptionalCustomerAuthOutcome =
  | { readonly ok: true; readonly principal: CustomerPrincipal | null }
  | { readonly ok: false; readonly status: 401 | 503; readonly error: string };

export type RequiredCustomerAuthOutcome =
  | { readonly ok: true; readonly principal: CustomerPrincipal }
  | { readonly ok: false; readonly status: 401 | 503; readonly error: string };

/**
 * Checkout creation is anonymous only when the header is absent. A malformed or
 * wrong-audience bearer is never silently downgraded to guest.
 */
export async function authenticateOptionalCustomer(
  authorization: string | undefined,
  config: CustomerVerificationConfig | undefined,
  nowSeconds: number
): Promise<OptionalCustomerAuthOutcome> {
  if (authorization === undefined) return { ok: true, principal: null };
  if (config === undefined) {
    return { ok: false, status: 503, error: 'Customer authentication is unavailable.' };
  }
  const token = readBearer(authorization);
  if (token === null) {
    return { ok: false, status: 401, error: 'Customer authorization required.' };
  }
  const principal = await verifyCustomerAccessToken(token, config, nowSeconds);
  return principal === null
    ? { ok: false, status: 401, error: 'Customer authorization required.' }
    : { ok: true, principal };
}

/** Required customer routes share the same verifier and never accept a guest. */
export async function authenticateRequiredCustomer(
  authorization: string | undefined,
  config: CustomerVerificationConfig | undefined,
  nowSeconds: number
): Promise<RequiredCustomerAuthOutcome> {
  const outcome = await authenticateOptionalCustomer(authorization, config, nowSeconds);
  if (!outcome.ok) return outcome;
  return outcome.principal === null
    ? { ok: false, status: 401, error: 'Customer authorization required.' }
    : { ok: true, principal: outcome.principal };
}

export async function verifyCustomerAccessToken(
  token: string,
  config: CustomerVerificationConfig,
  nowSeconds: number
): Promise<CustomerPrincipal | null> {
  const payload = await verifyAppIdJwt(token, config, nowSeconds);
  if (payload === null) return null;

  const subject = payload['sub'];
  if (typeof subject !== 'string' || subject.length === 0) return null;
  const scopes =
    typeof payload['scope'] === 'string' ? payload['scope'].split(/\s+/).filter(Boolean) : [];
  if (!scopes.includes(CUSTOMER_SCOPE)) return null;

  const issuer = appIdIssuer(config);
  const tenantId = config.capyTenantId ?? DEFAULT_TENANT_ID;
  if (tenantId.length === 0) return null;
  return {
    issuer,
    subject,
    tenantId,
    customerKey: deriveCustomerKey({ issuer, subject, tenantId }),
    keyVersion: CUSTOMER_KEY_VERSION,
  };
}

/** Length-delimited components avoid delimiter and prefix ambiguity. */
export function deriveCustomerKey(identity: {
  readonly issuer: string;
  readonly subject: string;
  readonly tenantId: string;
}): string {
  const canonical = [CUSTOMER_KEY_VERSION, identity.tenantId, identity.issuer, identity.subject]
    .map((part) => `${Buffer.byteLength(part, 'utf8')}:${part}`)
    .join('|');
  return createHash('sha256').update(canonical).digest('base64url');
}
