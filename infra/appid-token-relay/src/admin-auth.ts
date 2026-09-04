/**
 * The auth boundary for this relay's admin-only staff-management routes.
 *
 * Same HS256/RS256 dispatch shape as `infra/pos-api/src/session-auth.ts` (JWKS
 * cache-and-refetch-on-unknown-kid, issuer/audience pinning, one `null` for every
 * verification failure) — copied rather than imported, for the same reason
 * `session-auth.ts` itself gives: this is a standalone container with no path
 * into another service's `src/`.
 *
 * Deliberately **not** a fourth byte-identical copy of `infra/vision-proxy` and
 * `infra/clerk-agent-relay`'s `session-guard.ts`: those two stay identical to each
 * other because they check the exact same permission (`PROCESS_SALE`) for the
 * exact same reason. This file checks a different permission entirely —
 * `MANAGE_OPERATORS` — because its routes do something neither sibling proxy does:
 * create and manage other people's accounts. A caller here must already be an
 * admin of *this* store, verified the same way every other authenticated call in
 * this codebase is: the bearer token `AppIdAuthAdapter`/`LocalCredentialAuthAdapter`
 * already issued them, not a new credential invented for this file.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify as verifyRsaSignature } from 'node:crypto';

/** The one permission these routes ever check. */
export const Permission = {
  MANAGE_OPERATORS: 'admin:manage_operators',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];

export interface SessionClaims {
  readonly operatorId: string;
  readonly permissions: readonly string[];
}

export type AuthOutcome =
  | { readonly ok: true; readonly claims: SessionClaims }
  | { readonly ok: false; readonly status: 401 | 403 | 503; readonly error: string };

export interface AppIdVerificationConfig {
  readonly region: string;
  readonly tenantId: string;
  /** The staff application's client id — the token's `aud` must include this. */
  readonly audience: string;
}

/** `secret` alone (`appId` omitted) verifies HS256 only — same "omitted = today's exact behavior" convention as `session-auth.ts`. */
export interface AuthConfig {
  readonly secret: string;
  readonly appId?: AppIdVerificationConfig;
}

/**
 * Verify the bearer token and require `MANAGE_OPERATORS`.
 *
 * `nowSeconds` is a parameter, not a `Date.now()` call, so expiry is testable
 * without faking the clock — same reasoning as every other file in this codebase
 * that checks a JWT's `exp`.
 */
export async function authorize(
  authorization: string | undefined,
  config: AuthConfig,
  nowSeconds: number
): Promise<AuthOutcome> {
  if (config.secret.length === 0 && !config.appId) {
    return { ok: false, status: 503, error: 'Auth is not configured.' };
  }

  const token = readBearer(authorization);
  if (token === null) {
    return { ok: false, status: 401, error: 'Authorization required.' };
  }

  const claims = await verifyAnyToken(token, config, nowSeconds);
  if (claims === null) {
    return { ok: false, status: 401, error: 'Authorization required.' };
  }

  if (!claims.permissions.includes(Permission.MANAGE_OPERATORS)) {
    return { ok: false, status: 403, error: `Requires ${Permission.MANAGE_OPERATORS}.` };
  }

  return { ok: true, claims };
}

async function verifyAnyToken(
  token: string,
  config: AuthConfig,
  nowSeconds: number
): Promise<SessionClaims | null> {
  const header = decodeJson(token.split('.')[0] ?? '');
  if (header === null) {
    return null;
  }

  if (header['alg'] === 'HS256') {
    return config.secret.length > 0 ? verifySessionToken(token, config.secret, nowSeconds) : null;
  }
  if (header['alg'] === 'RS256' && config.appId) {
    return verifyAppIdAccessToken(token, config.appId, nowSeconds);
  }
  return null;
}

export function readBearer(authorization: string | undefined): string | null {
  if (typeof authorization !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

/** Verifies against `SessionIssuer`'s own local HS256 tokens — same shape as `session-auth.ts`'s copy. */
export function verifySessionToken(token: string, secret: string, nowSeconds: number): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];

  const header = decodeJson(encodedHeader);
  if (header === null || header['alg'] !== 'HS256') {
    return null;
  }

  if (!signatureMatches(`${encodedHeader}.${encodedPayload}`, signature, secret)) {
    return null;
  }

  const payload = decodeJson(encodedPayload);
  if (payload === null) {
    return null;
  }

  const expiresAt = payload['exp'];
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
    return null;
  }
  const notBefore = payload['nbf'];
  if (typeof notBefore === 'number' && Number.isFinite(notBefore) && notBefore > nowSeconds) {
    return null;
  }

  const operatorId = payload['sub'];
  if (typeof operatorId !== 'string' || operatorId.length === 0) {
    return null;
  }

  return { operatorId, permissions: stringArray(payload['permissions']) };
}

/**
 * Verify an App ID RS256 access token — same verification as
 * `AppIdAuthAdapter.verifyAccessToken()`/`session-auth.ts`'s copy, restricted to
 * this file's one permission.
 */
export async function verifyAppIdAccessToken(
  token: string,
  config: AppIdVerificationConfig,
  nowSeconds: number
): Promise<SessionClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];

  const header = decodeJson(encodedHeader);
  if (header === null || header['alg'] !== 'RS256') {
    return null;
  }

  const kid = header['kid'];
  if (typeof kid !== 'string' || kid.length === 0) {
    return null;
  }

  const jwk = await findJwk(kid, config);
  if (jwk === null) {
    return null;
  }

  if (!rs256SignatureMatches(`${encodedHeader}.${encodedPayload}`, signature, jwk)) {
    return null;
  }

  const payload = decodeJson(encodedPayload);
  if (payload === null) {
    return null;
  }

  const expiresAt = payload['exp'];
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
    return null;
  }
  const notBefore = payload['nbf'];
  if (typeof notBefore === 'number' && Number.isFinite(notBefore) && notBefore > nowSeconds) {
    return null;
  }

  if (payload['iss'] !== issuerFor(config)) {
    return null;
  }
  if (!audienceMatches(payload['aud'], config.audience)) {
    return null;
  }

  const operatorId = payload['sub'];
  if (typeof operatorId !== 'string' || operatorId.length === 0) {
    return null;
  }

  return { operatorId, permissions: resolveAppIdPermissions(payload['scope']) };
}

function issuerFor(config: AppIdVerificationConfig): string {
  return `https://${config.region}.appid.cloud.ibm.com/oauth/v4/${config.tenantId}`;
}

function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') {
    return aud === expected;
  }
  return Array.isArray(aud) && aud.includes(expected);
}

/**
 * Map App ID's `scope` claim → this file's one permission. Only the `admin`
 * scope grants `MANAGE_OPERATORS` — matches `ADMIN_PERMISSIONS` in
 * `permission.constants.ts`, where `MANAGE_OPERATORS` is admin-only, not
 * additive from `manager` the way most other permissions are.
 */
function resolveAppIdPermissions(rawScope: unknown): string[] {
  const scopes = typeof rawScope === 'string' ? rawScope.split(/\s+/).filter(Boolean) : [];
  return scopes.includes('admin') ? [Permission.MANAGE_OPERATORS] : [];
}

interface Jwk {
  readonly kid: string;
  readonly kty: string;
  readonly n: string;
  readonly e: string;
}

let jwksCache: readonly Jwk[] | null = null;

async function findJwk(kid: string, config: AppIdVerificationConfig): Promise<Jwk | null> {
  if (jwksCache === null) {
    const fetched = await fetchJwks(config);
    if (fetched === null) {
      return null;
    }
    jwksCache = fetched;
  }

  const hit = jwksCache.find((key) => key.kid === kid);
  if (hit) {
    return hit;
  }

  const refetched = await fetchJwks(config);
  if (refetched === null) {
    return null;
  }
  jwksCache = refetched;
  return jwksCache.find((key) => key.kid === kid) ?? null;
}

async function fetchJwks(config: AppIdVerificationConfig): Promise<readonly Jwk[] | null> {
  let response: Response;
  try {
    response = await fetch(`${issuerFor(config)}/publickeys`);
  } catch (error) {
    console.error('[appid-relay] App ID JWKS fetch failed', error);
    return null;
  }
  if (!response.ok) {
    console.error(`[appid-relay] App ID JWKS fetch returned ${response.status}`);
    return null;
  }
  try {
    const data = (await response.json()) as { keys?: Jwk[] };
    return data.keys ?? [];
  } catch (error) {
    console.error('[appid-relay] App ID JWKS response was not valid JSON', error);
    return null;
  }
}

function rs256SignatureMatches(signingInput: string, signature: string, jwk: Jwk): boolean {
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(base64UrlToBase64(signature), 'base64');
  } catch {
    return false;
  }

  try {
    const publicKey = createPublicKey({ key: { kty: jwk.kty, n: jwk.n, e: jwk.e }, format: 'jwk' });
    return verifyRsaSignature('RSA-SHA256', Buffer.from(signingInput), publicKey, signatureBytes);
  } catch {
    return false;
  }
}

function signatureMatches(signingInput: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(signingInput).digest();
  let presented: Buffer;
  try {
    presented = Buffer.from(base64UrlToBase64(signature), 'base64');
  } catch {
    return false;
  }
  return presented.length === expected.length && timingSafeEqual(presented, expected);
}

function decodeJson(segment: string): Record<string, unknown> | null {
  try {
    const json = Buffer.from(base64UrlToBase64(segment), 'base64').toString('utf8');
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function base64UrlToBase64(value: string): string {
  return value.replace(/-/g, '+').replace(/_/g, '/');
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}
