/**
 * The auth and CORS boundary for a proxy that runs as a plain container.
 *
 * ## Why this file exists at all
 *
 * Both proxies used to say, in their handlers and their READMEs, "deploy this behind
 * the existing API Gateway authorizer". Epic #195 established that no such
 * authorizer was ever built — `terraform/aws-demo/main.tf` has no
 * `aws_apigatewayv2_authorizer` resource and `environment.ts` ships
 * `cognito.enabled: false` — so the boundary was a sentence, not a check. Moving to
 * Code Engine removes even the possibility of hand-off: there is no gateway in front
 * of the container to delegate to, declaratively or otherwise. So the check lands
 * here, in the process that spends the model key.
 *
 * ## What it checks
 *
 * The HS256 session token the till already holds. `SessionIssuer.issueFor`
 * (`src/app/core/infrastructure/auth/session-issuer.ts`) mints one on every
 * successful sign-in — password, passkey and PIN all funnel through it — and
 * `claude-vision.adapter.ts` already sends it as a bearer on every frame. Verifying
 * that token needs no new issuer and no new browser plumbing, and it is the same
 * answer `infra/pos-api/src/session-auth.ts` reached for story #196, so the three
 * services agree on what a caller is.
 *
 * Beyond authentication, one permission: `sale:process`. A camera frame or an agent
 * hop can add a line to a cart, so the token that pays for it should be one that is
 * allowed to sell. Every role in `permission.constants.ts` — operator, manager,
 * admin — carries it, so this refuses tokens minted for something that is not a
 * till, not people doing their jobs.
 *
 * ## What it does not buy
 *
 * The signing secret is shared with a **public browser bundle**, so anyone who loads
 * the SPA can read it and mint whatever claims they like. This bounds
 * *reachability*, not *identity*: it stops unauthenticated callers, scanners and
 * cross-origin pages from spending the shop's model budget, and it does not stop
 * someone who has read the bundle. Closing that needs a server-side issuer, which
 * needs the operator store to live server-side — issue #140's remit, not this
 * story's. Stated here rather than only in the README because the bug this epic is
 * fixing *was* a README that overstated a boundary.
 *
 * ## App ID's RS256 tokens
 *
 * `AppIdAuthAdapter` (`src/app/core/infrastructure/auth/appid-auth.adapter.ts`)
 * stores App ID's own access token and sends it here as-is — there is no second,
 * locally-minted HS256 token the way `LocalCredentialAuthAdapter` produces one via
 * `SessionIssuer`. That token is signed RS256 against the tenant's own key, not
 * HS256 against `SESSION_JWT_SECRET`, so it needs its own verification path — the
 * exact same one added to `infra/pos-api/src/session-auth.ts`, applied here
 * identically (see that file's own doc comment for the full reasoning; kept out of
 * this copy only to the extent the "why a copy" section below already explains).
 * `authorize()` dispatches on the token's own declared `alg`: `HS256` is exactly the
 * path this file already had; `RS256` fetches (and caches) the tenant's JWKS and
 * verifies against it. Either algorithm is refused as a plain invalid token — 401,
 * not 503 — when this deployment has not been given credentials for it; only
 * "neither method configured at all" is a 503.
 *
 * ## Why a copy rather than an import
 *
 * This file exists twice. `infra/vision-proxy/src/session-guard.ts` and
 * `infra/clerk-agent-relay/src/session-guard.ts` are byte-identical to each other,
 * and near-identical to `infra/pos-api/src/session-auth.ts`. Each service is a
 * standalone container with its own `tsconfig` `rootDir` and its own image, and
 * TypeScript refuses to compile a source file from outside `rootDir` (TS6059), so a
 * shared module would mean a shared build context for services that deliberately
 * have none.
 *
 * A copy is only safe if drift is loud, so `session-guard.test.mjs` — which is
 * itself the same file on both sides — asserts it: it reads both copies off disk and
 * fails if they differ by a byte, and asserts the permission string against the
 * Angular app's `permission.constants.ts`. The claims and permission strings are a
 * wire contract, travelling inside a signed token, so a rename that is not mirrored
 * fails a test rather than silently 401-ing a till.
 *
 * That suite also asserts that each `server.ts` actually *calls* this module and
 * never answers `Access-Control-Allow-Origin: *`. The first review of this story
 * found the file written, deployed, and bound into Terraform — and imported by
 * nothing, which is a boundary in exactly the sense this epic exists to stop
 * accepting.
 */
import { createHmac, createPublicKey, timingSafeEqual, verify as verifyRsaSignature } from 'node:crypto';

/**
 * The multi-tenant id App ID's own tokens are stamped with, since this pilot is
 * effectively single-tenant today. Copied from
 * `src/app/core/infrastructure/database/dexie-database.service.ts`'s
 * `DEFAULT_TENANT_ID` for the same reason `Permission` below is copied rather
 * than imported: a container has no path into `src/`.
 */
const DEFAULT_TENANT_ID = 'default-tenant';

/** The claims a proxy reads. The token carries more; the rest is ignored. */
export interface SessionClaims {
  readonly operatorId: string;
  readonly tenantId: string;
  readonly roles: readonly string[];
  readonly permissions: readonly string[];
  /** `exp`, epoch seconds. */
  readonly expiresAt: number;
}

export type AuthOutcome =
  | { readonly ok: true; readonly claims: SessionClaims }
  | { readonly ok: false; readonly status: 401 | 403 | 503; readonly error: string };

/**
 * The one permission a proxy call needs, copied from
 * `src/app/core/domain/auth/permission.constants.ts` and asserted by the suite.
 */
export const Permission = {
  PROCESS_SALE: 'sale:process',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/** What App ID's own token endpoint requires this proxy to know to verify one. */
export interface AppIdVerificationConfig {
  readonly region: string;
  readonly tenantId: string;
  /** The staff application's client id — the token's `aud` must include this. */
  readonly audience: string;
}

/**
 * Everything `authorize()` needs. `secret` alone (`appId` omitted) is exactly
 * today's behaviour: a deployment that has not been given App ID env vars
 * verifies HS256 only, unchanged.
 */
export interface AuthConfig {
  readonly secret: string;
  readonly appId?: AppIdVerificationConfig;
}

/**
 * Verify the bearer token and check one permission.
 *
 * `nowSeconds` is a parameter rather than a `Date.now()` call so expiry is testable
 * without faking a clock, the way `retry.service.spec.ts` treats time in the Angular
 * app. Async now, unlike this file's originally pure functions: a cache-miss on the
 * App ID JWKS is a real network call — see `verifyAppIdAccessToken` below.
 */
export async function authorize(
  authorization: string | undefined,
  required: Permission | null,
  config: AuthConfig,
  nowSeconds: number
): Promise<AuthOutcome> {
  // Fail closed and loudly on a deployment configured for neither method at all.
  // `server.ts` refuses to start without at least one, so reaching this means the
  // environment changed under a running process: 503 "this service is broken" is
  // true, 401 "your token is bad" is not. A token whose algorithm matches only the
  // *other*, unconfigured method is a different case — see `verifyAnyToken` — and
  // is a plain 401, not this 503.
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

  if (required !== null && !claims.permissions.includes(required)) {
    // Names the missing permission: the caller is authenticated, so telling them
    // what they lack is a usable error rather than an oracle.
    return { ok: false, status: 403, error: `Requires ${required}.` };
  }

  return { ok: true, claims };
}

/**
 * Dispatch on the token's own declared `alg`. Neither branch trusts a caller who
 * merely claims an algorithm without the key to back it: HS256 is verified against
 * `config.secret`, RS256 against the App ID tenant's JWKS. An algorithm this
 * deployment has no credentials for — including HS256 with an *empty* secret, which
 * is a known, publicly-computable HMAC key and not "HS256 disabled" — is refused
 * exactly like a malformed token, one `null` for every reason, same as
 * `verifySessionToken`'s own documented contract.
 */
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

/**
 * Pull the token out of an `Authorization` header.
 *
 * Case-insensitive on the scheme (`Bearer` and `bearer` are both sent in the wild)
 * and strict about there being exactly one non-empty token after it. Node lowercases
 * incoming header *names* already, so only the value is handled here.
 */
export function readBearer(authorization: string | undefined): string | null {
  if (typeof authorization !== 'string') {
    return null;
  }
  const match = /^Bearer\s+(\S+)$/i.exec(authorization.trim());
  return match?.[1] ?? null;
}

/**
 * Verify an HS256 JWT and return its claims, or null for any reason at all.
 *
 * One null for every failure on purpose: the caller turns it into one 401, and a
 * response distinguishing "expired" from "bad signature" from "not a JWT" would be a
 * probing oracle for no operational gain — the till's only recovery for all three is
 * to sign in again.
 */
export function verifySessionToken(
  token: string,
  secret: string,
  nowSeconds: number
): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3) {
    return null;
  }
  const [encodedHeader, encodedPayload, signature] = parts as [string, string, string];

  const header = decodeJson(encodedHeader);
  // Pin the algorithm. `alg: "none"` and an RS256 header whose "signature" is an
  // HMAC of the public key are the two classic JWT confusions, and refusing anything
  // but HS256 before touching the signature closes both.
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
  // `nbf` is not set by `SessionIssuer`, but a token that carries one and is not yet
  // valid is still not a valid token.
  const notBefore = payload['nbf'];
  if (typeof notBefore === 'number' && Number.isFinite(notBefore) && notBefore > nowSeconds) {
    return null;
  }

  const operatorId = payload['sub'];
  const tenantId = payload['tenantId'];
  // A signed token with no subject or no tenant is not one a spend can be attributed
  // to, so it is refused rather than treated as anonymous-but-valid.
  if (typeof operatorId !== 'string' || operatorId.length === 0) {
    return null;
  }
  if (typeof tenantId !== 'string' || tenantId.length === 0) {
    return null;
  }

  return {
    operatorId,
    tenantId,
    roles: stringArray(payload['roles']),
    permissions: stringArray(payload['permissions']),
    expiresAt,
  };
}

/**
 * Verify an App ID RS256 access token and return its claims, or null for any reason
 * at all — same one-`null` contract as `verifySessionToken` above, for the same
 * reason: the caller turns it into one 401, and distinguishing failure modes would
 * be a probing oracle for no operational gain.
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

  // Pinned the same way `AppIdAuthAdapter.verifyAccessToken()` pins them
  // client-side — a token from a different tenant, or minted for a different
  // application, must not verify here just because the signature is real.
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

  const { roles, permissions } = resolveAppIdScopes(payload['scope']);

  return {
    operatorId,
    // App ID's own `tenant` claim is the service instance's id, the same for
    // every user — not a per-store Capy-POS tenant. See this file's header.
    tenantId: DEFAULT_TENANT_ID,
    roles,
    permissions,
    expiresAt,
  };
}

function issuerFor(config: AppIdVerificationConfig): string {
  return `https://${config.region}.appid.cloud.ibm.com/oauth/v4/${config.tenantId}`;
}

/** `aud` is an array on a real App ID token, confirmed by decoding one — but a string is accepted too, defensively. */
function audienceMatches(aud: unknown, expected: string): boolean {
  if (typeof aud === 'string') {
    return aud === expected;
  }
  return Array.isArray(aud) && aud.includes(expected);
}

/**
 * Map App ID's `scope` claim → this proxy's own permission set.
 *
 * Restricted to the one permission `Permission` above already copies — every
 * built-in role carries it, same as the doc comment at the top of this file already
 * says of `permission.constants.ts`'s hierarchy. Only resolves these three built-in
 * role names — a custom App ID scope beyond operator/manager/admin would need a
 * matching entry here, same limitation `AppIdAuthAdapter`'s own `Role.fromName()`
 * filtering already has client-side. `session-guard.test.mjs` pins this table so a
 * rename on the Angular side that is not mirrored here silently narrows or widens
 * what a role can do, rather than failing a test.
 */
const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  operator: [Permission.PROCESS_SALE],
  manager: [Permission.PROCESS_SALE],
  admin: [Permission.PROCESS_SALE],
};

function resolveAppIdScopes(rawScope: unknown): { roles: string[]; permissions: string[] } {
  const scopes = typeof rawScope === 'string' ? rawScope.split(/\s+/).filter(Boolean) : [];
  const permissions = new Set<Permission>();
  const roles: string[] = [];

  for (const scope of scopes) {
    const granted = ROLE_PERMISSIONS[scope];
    if (!granted) {
      continue; // an App ID framework scope, or an unknown name — not a role
    }
    roles.push(scope);
    for (const permission of granted) {
      permissions.add(permission);
    }
  }

  return { roles, permissions: [...permissions] };
}

interface Jwk {
  readonly kid: string;
  readonly kty: string;
  readonly n: string;
  readonly e: string;
}

/** JWKS is immutable per tenant; cache it after the first fetch, same shape as `AppIdAuthAdapter.jwksCache`. */
let jwksCache: readonly Jwk[] | null = null;

async function findJwk(kid: string, config: AppIdVerificationConfig): Promise<Jwk | null> {
  if (jwksCache === null) {
    const fetched = await fetchJwks(config);
    // A failed fetch is not "an empty JWKS" — leave the cache null (so the next
    // call retries from scratch) and refuse this one lookup outright, rather
    // than spending a second attempt that is no more likely to succeed than
    // the first.
    if (fetched === null) {
      return null;
    }
    jwksCache = fetched;
  }

  const hit = jwksCache.find((key) => key.kid === kid);
  if (hit) {
    return hit;
  }

  // Not in the cached set — maybe a fresh rotation. Refetch once, same as
  // `AppIdAuthAdapter.findJwk()`. If *this* attempt also fails, keep the
  // existing cache rather than discarding a possibly-still-good one over a
  // transient blip.
  const refetched = await fetchJwks(config);
  if (refetched === null) {
    return null;
  }
  jwksCache = refetched;
  return jwksCache.find((key) => key.kid === kid) ?? null;
}

/** `null` means the fetch itself failed — distinct from a successful fetch of zero keys. */
async function fetchJwks(config: AppIdVerificationConfig): Promise<readonly Jwk[] | null> {
  let response: Response;
  try {
    response = await fetch(`${issuerFor(config)}/publickeys`);
  } catch (error) {
    // Not folded into the caller's 401: a JWKS outage means every real App ID
    // token fails the same way a forged one would, and an operator watching the
    // logs deserves to tell those two apart even though the caller cannot.
    console.error('[session-guard] App ID JWKS fetch failed', error);
    return null;
  }
  if (!response.ok) {
    console.error(`[session-guard] App ID JWKS fetch returned ${response.status}`);
    return null;
  }
  try {
    const data = (await response.json()) as { keys?: Jwk[] };
    return data.keys ?? [];
  } catch (error) {
    console.error('[session-guard] App ID JWKS response was not valid JSON', error);
    return null;
  }
}

/**
 * RSA signature check for an App ID access token. `createPublicKey` has taken a
 * JWK-shaped public key directly since Node v15.9, and `verify`'s synchronous
 * overload (no callback) returns a boolean rather than throwing on a bad signature
 * — only a malformed key or a malformed signature buffer throws, both caught below
 * and treated as "does not verify", not "crashes the process".
 */
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

/**
 * Parse `ALLOWED_ORIGINS` — a comma-separated list of browser origins.
 *
 * Trailing slashes are stripped and the result deduplicated, because an `Origin`
 * header never carries a path and a list entry that does would silently match
 * nothing. An empty result is the signal `server.ts` uses to refuse to start: no
 * origin at all is a configuration mistake, and the alternative it replaces —
 * `Access-Control-Allow-Origin: *` in front of a metered model — is the thing this
 * story exists to remove.
 */
export function readAllowedOrigins(raw: string | undefined): readonly string[] {
  if (typeof raw !== 'string') {
    return [];
  }
  return [
    ...new Set(
      raw
        .split(',')
        .map((entry) => entry.trim().replace(/\/+$/, ''))
        .filter((entry) => entry.length > 0)
    ),
  ];
}

/**
 * Whether a request's `Origin` may be answered.
 *
 * A *missing* Origin passes: `curl`, `smoke.mjs` and any server-to-server caller
 * send none, and they are still made to present a token. A *present but unlisted*
 * one is refused outright rather than merely left without an
 * `Access-Control-Allow-Origin` header — omitting the header stops a compliant
 * browser reading the reply, but the request has already been served and the model
 * already billed by then.
 */
export function originAllowed(origin: string | undefined, allowed: readonly string[]): boolean {
  if (typeof origin !== 'string' || origin.length === 0 || origin === 'null') {
    // `Origin: null` is what a sandboxed iframe or a `file://` page sends. It is not
    // an origin that can be allow-listed, and treating it as absent would let one in
    // through the no-Origin door.
    return typeof origin !== 'string' || origin.length === 0;
  }
  return allowed.includes(origin.replace(/\/+$/, ''));
}

/**
 * CORS headers for one response. Never `*`.
 *
 * The allowed origin is echoed back, which is what `Vary: Origin` is for: without it
 * a shared cache can hand one origin's allow header to another. `Authorization` in
 * `Allow-Headers` is what lets the till send a token at all — a preflight that omits
 * it makes the browser drop the header and every call arrives unauthenticated.
 */
export function corsHeaders(
  origin: string | undefined,
  allowed: readonly string[],
  methods: string
): Record<string, string> {
  const headers: Record<string, string> = {
    Vary: 'Origin',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': methods,
    'Access-Control-Max-Age': '600',
  };
  if (typeof origin === 'string' && origin.length > 0 && originAllowed(origin, allowed)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

/**
 * Constant-time signature comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so lengths are compared first —
 * which leaks only the *length* of a forged signature, a value the attacker chose.
 */
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

/** Decode one base64url JWT segment into a plain object, or null if it isn't one. */
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

/** A claim that should be an array of strings, reduced to exactly that. */
function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

// Made with Bob
