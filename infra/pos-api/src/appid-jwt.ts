import { createPublicKey, verify as verifyRsaSignature } from 'node:crypto';

export interface AppIdJwtVerificationConfig {
  readonly region: string;
  readonly tenantId: string;
  readonly audience: string;
}

interface Jwk {
  readonly kid: string;
  readonly kty: string;
  readonly n: string;
  readonly e: string;
}

/**
 * Keys are scoped by issuer. A process can verify staff and customer applications
 * from different App ID tenants, and one tenant's `kid` must never satisfy another.
 */
const jwksByIssuer = new Map<string, readonly Jwk[]>();

/**
 * Verify App ID's cryptographic and registered JWT claims without assigning an
 * application principal. Staff/customer claim mapping belongs to their separate
 * authentication boundaries.
 */
export async function verifyAppIdJwt(
  token: string,
  config: AppIdJwtVerificationConfig,
  nowSeconds: number
): Promise<Readonly<Record<string, unknown>> | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];

  const header = decodeJson(encodedHeader);
  if (header === null || header['alg'] !== 'RS256') return null;
  const kid = header['kid'];
  if (typeof kid !== 'string' || kid.length === 0) return null;

  const jwk = await findJwk(kid, config);
  if (jwk === null) return null;
  if (!rs256SignatureMatches(`${encodedHeader}.${encodedPayload}`, signature, jwk)) return null;

  const payload = decodeJson(encodedPayload);
  if (payload === null) return null;

  const expiresAt = payload['exp'];
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt) || expiresAt <= nowSeconds) {
    return null;
  }
  const notBefore = payload['nbf'];
  if (typeof notBefore === 'number' && Number.isFinite(notBefore) && notBefore > nowSeconds) {
    return null;
  }
  if (payload['iss'] !== appIdIssuer(config)) return null;
  if (!audienceMatches(payload['aud'], config.audience)) return null;

  return payload;
}

export function appIdIssuer(
  config: Pick<AppIdJwtVerificationConfig, 'region' | 'tenantId'>
): string {
  return `https://${config.region}.appid.cloud.ibm.com/oauth/v4/${config.tenantId}`;
}

async function findJwk(kid: string, config: AppIdJwtVerificationConfig): Promise<Jwk | null> {
  const issuer = appIdIssuer(config);
  let keys = jwksByIssuer.get(issuer);
  if (keys === undefined) {
    const fetched = await fetchJwks(config);
    if (fetched === null) return null;
    keys = fetched;
    jwksByIssuer.set(issuer, keys);
  }

  const hit = keys.find((key) => key.kid === kid);
  if (hit) return hit;

  const refetched = await fetchJwks(config);
  if (refetched === null) return null;
  jwksByIssuer.set(issuer, refetched);
  return refetched.find((key) => key.kid === kid) ?? null;
}

async function fetchJwks(config: AppIdJwtVerificationConfig): Promise<readonly Jwk[] | null> {
  let response: Response;
  try {
    response = await fetch(`${appIdIssuer(config)}/publickeys`);
  } catch (error) {
    console.error('[pos-api] App ID JWKS fetch failed', error);
    return null;
  }
  if (!response.ok) {
    console.error(`[pos-api] App ID JWKS fetch returned ${response.status}`);
    return null;
  }
  try {
    const data = (await response.json()) as { keys?: Jwk[] };
    return Array.isArray(data.keys) ? data.keys : [];
  } catch (error) {
    console.error('[pos-api] App ID JWKS response was not valid JSON', error);
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
    const publicKey = createPublicKey({
      key: { kty: jwk.kty, n: jwk.n, e: jwk.e },
      format: 'jwk',
    });
    return verifyRsaSignature('RSA-SHA256', Buffer.from(signingInput), publicKey, signatureBytes);
  } catch {
    return false;
  }
}

function audienceMatches(audience: unknown, expected: string): boolean {
  if (typeof audience === 'string') return audience === expected;
  return Array.isArray(audience) && audience.includes(expected);
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
