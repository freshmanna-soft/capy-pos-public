/**
 * The auth boundary, and the reason it looks like this.
 *
 * `infra/vision-proxy/README.md` and `infra/clerk-agent-relay/src/lambda.ts` both
 * say to deploy "behind the existing API Gateway authorizer". Epic #195 established
 * that no such authorizer was ever built: `terraform/aws-demo/main.tf` has no
 * `aws_apigatewayv2_authorizer` resource, and `environment.ts:48` ships
 * `cognito.enabled: false` with empty pool ids. So three services describe a
 * boundary that does not exist, and this file is where one starts existing.
 *
 * ## What is being verified
 *
 * Issue #196 guessed that "no externally-verifiable token exists to check against
 * yet". Reading the code, one does:
 * `src/app/core/infrastructure/auth/session-issuer.ts` already mints an HS256 JWT
 * on every successful sign-in — password, passkey and PIN all funnel through
 * `SessionIssuer.issueFor` — carrying `sub`, `tenantId`, `roles`, `permissions` and
 * `exp`. The browser already stores it and `CurrentUserService` already exposes it.
 * Verifying *that* token needs no new issuer, no new browser plumbing, and no new
 * identity provider: it is the credential the till already holds.
 *
 * So: HS256 over the same shared secret, plus a per-route permission check read
 * from the token's own `permissions` claim, using the permission strings from
 * `src/app/core/domain/auth/permission.constants.ts`.
 *
 * ## What that buys, precisely
 *
 * - A request with no token, a malformed token, a token signed with a different
 *   secret, or a token whose `exp` has passed never reaches product or transaction
 *   data. That is the difference between this API and the open internet, and it is
 *   real: today's AWS routes have no check of any kind.
 * - A token minted for an `operator` cannot `DELETE /api/products/{id}`, because
 *   `inventory:delete` is not in its `permissions` claim. Authorization was
 *   previously a browser-side concern only (guards and directives); this is the
 *   first time the server enforces any of it.
 *
 * ## What it does not buy, equally precisely
 *
 * The signing secret is shared with a **public browser bundle**. Anyone who loads
 * the SPA can read it and mint a token with any claims they like. So this bounds
 * *reachability*, not *identity*: it stops unauthenticated callers and scanners, and
 * it does not stop someone who has read the bundle. Closing that gap needs a
 * server-side issuer, which needs the operator store to live server-side — that is
 * #140's remit (Cognito/App ID), not this story's, and the story's non-goals say so.
 *
 * That distinction is stated here, in the two proxies' READMEs, and in
 * `terraform/README.md`, because the failure this epic is fixing was documentation
 * that overstated a boundary — replacing it with documentation that overstates a
 * different one would be the same bug.
 *
 * ## Why hand-rolled rather than `jose`
 *
 * The Angular app uses `jose`. This service has zero runtime dependencies, like its
 * two sibling services, and one HMAC comparison does not justify breaking that:
 * `node:crypto` verifies HS256 in a dozen lines, and the algorithm is pinned to
 * HS256 by construction below rather than by a library option that can be passed
 * wrongly. The same reasoning extends to App ID's RS256 tokens below: Node's
 * `createPublicKey` has accepted a JWK-shaped public key directly since v15.9, so
 * verifying an RSA signature needs no library either.
 *
 * ## App ID's RS256 tokens
 *
 * `AppIdAuthAdapter` (`src/app/core/infrastructure/auth/appid-auth.adapter.ts`)
 * stores App ID's own access token and sends it here as-is — there is no second,
 * locally-minted HS256 token the way `LocalCredentialAuthAdapter` produces one via
 * `SessionIssuer`. That token is signed RS256 against the tenant's own key, not
 * HS256 against `SESSION_JWT_SECRET`, so it needs its own verification path —
 * `AppIdAuthAdapter`'s own doc comment names this file as the known gap this
 * closes.
 *
 * `authorize()` dispatches on the token's own declared `alg`: `HS256` is exactly
 * the path this file already had; `RS256` fetches (and caches) the tenant's JWKS
 * and verifies against it, pinning issuer and audience the same way
 * `AppIdAuthAdapter.verifyAccessToken()` does client-side. Either algorithm is
 * refused as a plain invalid token — 401, not 503 — when this deployment has not
 * been given credentials for it: only "neither method is configured at all" is a
 * 503, the same "the service is broken, not your token" distinction the original
 * HS256-only version already drew.
 *
 * App ID's own `tenant` claim is the *service instance's* id, the same for every
 * user, not a per-store Capy-POS tenant — so `tenantId` below is the fixed
 * `DEFAULT_TENANT_ID`, matching the choice `AppIdAuthAdapter.sessionFromToken()`
 * already makes. And App ID's access-control model is scopes-compiled-into-roles,
 * verified via the token's `scope` claim, not a permissions array — `ROLE_PERMISSIONS`
 * below is this file's own copy of that mapping, restricted to the five
 * permissions `Permission` already copies, the same way `Permission` itself is
 * already a restricted copy of `permission.constants.ts`.
 *
 * ## Phase 5: the shared roles document
 *
 * `resolveAppIdScopes` no longer trusts only `ROLE_PERMISSIONS` — when
 * `AppIdVerificationConfig.rolesSource` is set (`api.ts` passes `deps.roles`,
 * the same `roles` Cloudant store `GET /internal/roles` serves to the two
 * sibling proxies), it reads that document instead, cached for
 * `ROLES_CACHE_TTL_MS`. `ROLE_PERMISSIONS` stays as the fallback for an
 * unconfigured deployment or a read that has never once succeeded — see its
 * own doc comment below.
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

/** The claims this API reads. A superset exists in the token; the rest is ignored. */
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
 * Permission strings, copied from `src/app/core/domain/auth/permission.constants.ts`.
 *
 * Copied rather than imported: that file is Angular application code and this is a
 * standalone container with no path into `src/`. The values are a wire contract —
 * they travel inside a signed token — so they are as safe to restate here as the
 * route paths are. `session-auth.test.mjs` asserts the exact strings, so a rename on
 * either side that is not mirrored fails a test rather than silently 403-ing a till.
 */
export const Permission = {
  PROCESS_SALE: 'sale:process',
  VIEW_TRANSACTIONS: 'sale:view_transactions',
  VIEW_INVENTORY: 'inventory:view',
  MANAGE_INVENTORY: 'inventory:manage',
  DELETE_PRODUCT: 'inventory:delete',
} as const;

export type Permission = (typeof Permission)[keyof typeof Permission];

/**
 * The minimal shape `resolveAppIdScopes` needs from the shared `roles`
 * Cloudant store — `api.ts`'s own `DocumentStore<RolesDocument>.read()`
 * already satisfies this structurally, so no import is needed in either
 * direction: `api.ts` already imports from this file, and this file stays
 * dependency-light (see "Why hand-rolled rather than `jose`" above) rather
 * than pulling in `StoredDocument`/`DocumentStore` just for one method
 * signature.
 */
export interface RolesReader {
  read(
    id: string
  ): Promise<{ readonly document: { readonly roles: Readonly<Record<string, readonly string[]>> } } | null>;
}

/** What App ID's own token endpoint requires this API to know to verify one. */
export interface AppIdVerificationConfig {
  readonly region: string;
  readonly tenantId: string;
  /** The staff application's client id — the token's `aud` must include this. */
  readonly audience: string;
  /**
   * The shared `roles` document (Phase 5, RBAC centralization) —
   * `deps.roles` from `api.ts`, read in-process (no HTTP hop, unlike
   * `vision-proxy`/`clerk-agent-relay`'s own copies, which fetch this same
   * document over `GET /internal/roles` instead). Omitted means:
   * `resolveAppIdScopes` answers from its own literal `ROLE_PERMISSIONS`
   * table below, unchanged from before Phase 5.
   */
  readonly rolesSource?: RolesReader;
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
 * `required` of `null` means "authentication only, no specific permission" — used by
 * nothing today, but the distinction is what keeps `/api/health` (which skips this
 * function entirely) from being confused with an authenticated-but-unprivileged
 * route.
 *
 * `nowSeconds` is a parameter rather than a `Date.now()` call so expiry is testable
 * without waiting or faking the clock, the same way `retry.service.spec.ts` treats
 * time in the Angular app. Async now, unlike the rest of this file's originally
 * pure functions: a cache-miss on the App ID JWKS is a real network call — see
 * `verifyAppIdAccessToken` below.
 */
export async function authorize(
  authorization: string | undefined,
  required: Permission | null,
  config: AuthConfig,
  nowSeconds: number
): Promise<AuthOutcome> {
  // Fail closed, loudly, on a deployment configured for neither method at all.
  // `server.ts` refuses to start without at least one, so reaching this means the
  // env changed underneath a running process — a 503 says "this service is
  // broken", which is true, rather than 401 "your token is bad", which is not.
  // A token whose algorithm matches only the *other*, unconfigured method is a
  // different case — see `verifyAnyToken` — and is a plain 401, not this 503.
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
    // what they lack is a usable error rather than an oracle. A 401 body says
    // nothing for the opposite reason.
    return { ok: false, status: 403, error: `Requires ${required}.` };
  }

  return { ok: true, claims };
}

/**
 * Dispatch on the token's own declared `alg`. Neither branch trusts a caller who
 * merely claims an algorithm without the key to back it: HS256 is verified
 * against `config.secret`, RS256 against the App ID tenant's JWKS. An algorithm
 * this deployment has no credentials for — including HS256 with an *empty*
 * secret, which is a known, publicly-computable HMAC key and not "HS256
 * disabled" — is refused exactly like a malformed token, one `null` for every
 * reason, same as `verifySessionToken`'s own documented contract.
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
 * Case-insensitive on the scheme (`Bearer`/`bearer` are both sent in the wild) and
 * strict about there being exactly one non-empty token after it. Node lowercases
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
 * response that distinguished "expired" from "bad signature" from "not a JWT" would
 * be a probing oracle for no operational gain — the till's only recovery for all
 * three is to sign in again.
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
  // HMAC of the public key are the two classic JWT confusions, and refusing
  // anything but HS256 before touching the signature closes both.
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
  // A signed token with no subject or no tenant is not one this API can attribute a
  // write to, so it is refused rather than treated as an anonymous-but-valid caller.
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
 * Verify an App ID RS256 access token and return its claims, or null for any
 * reason at all — same one-`null` contract as `verifySessionToken` above, for
 * the same reason: the caller turns it into one 401, and distinguishing failure
 * modes would be a probing oracle for no operational gain.
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

  const { roles, permissions } = await resolveAppIdScopes(payload['scope'], config, nowSeconds);

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
 * Map App ID's `scope` claim → this API's own permission set.
 *
 * Restricted to the five permissions `Permission` above already copies —
 * additive by role level, mirroring `permission.constants.ts`'s
 * `OPERATOR_PERMISSIONS`/`MANAGER_PERMISSIONS`/`ADMIN_PERMISSIONS`,
 * hand-restricted the same way `Permission` itself already is. Only resolves
 * these three built-in role names — a custom App ID scope beyond
 * operator/manager/admin would need a matching entry here, same limitation
 * `AppIdAuthAdapter`'s own `Role.fromName()` filtering already has
 * client-side. `session-auth.test.mjs` pins this table so a rename on the
 * Angular side that is not mirrored here silently narrows or widens what a
 * role can do, rather than failing a test.
 *
 * **Exported (Phase 5, RBAC centralization) as the seed content and the
 * fallback for `GET /internal/roles`** (`api.ts`) — the route the two
 * sibling proxies fetch instead of each hand-copying their own version of
 * this exact table. This literal table does not disappear: it is what a
 * fresh `roles` Cloudant database seeds from, and what every consumer falls
 * back to if the document is missing or the fetch fails outright, so a
 * partially-rolled-out deployment degrades to today's behaviour rather than
 * granting zero permissions to every RS256-authenticated caller.
 */
export const ROLE_PERMISSIONS: Readonly<Record<string, readonly Permission[]>> = {
  operator: [Permission.PROCESS_SALE, Permission.VIEW_TRANSACTIONS, Permission.VIEW_INVENTORY],
  manager: [
    Permission.PROCESS_SALE,
    Permission.VIEW_TRANSACTIONS,
    Permission.VIEW_INVENTORY,
    Permission.MANAGE_INVENTORY,
  ],
  admin: [
    Permission.PROCESS_SALE,
    Permission.VIEW_TRANSACTIONS,
    Permission.VIEW_INVENTORY,
    Permission.MANAGE_INVENTORY,
    Permission.DELETE_PRODUCT,
  ],
};

/**
 * The one document id the shared `roles` store ever holds — must match
 * `ROLES_DOC_ID` in `api.ts` exactly (a tiny wire-contract constant,
 * duplicated the same deliberate way `DEFAULT_TENANT_ID` above is copied
 * from the Angular app, rather than importing `api.ts` into this
 * lower-level module and creating a circular import).
 */
const ROLES_DOC_ID = 'role-permissions';

/**
 * How long a value read from the shared roles document is trusted before
 * the next resolution re-reads it. Roles change rarely — an admin edit
 * through the "Roles & Permissions" panel, not a per-request event — so a
 * short TTL bounds staleness without a Cloudant read on every token
 * verified. Same constant and same reasoning as the two proxies' own copy
 * of this cache.
 */
const ROLES_CACHE_TTL_MS = 5 * 60 * 1000;

let rolesCache: { readonly data: Readonly<Record<string, readonly string[]>>; readonly fetchedAtMs: number } | null =
  null;

/**
 * Resolve the current role → permission mapping: the shared document when
 * `rolesSource` is configured and reachable, this file's own `ROLE_PERMISSIONS`
 * otherwise. `nowMs` is a parameter for the same testability reason
 * `nowSeconds` is threaded everywhere else in this file — no bare `Date.now()`.
 */
async function resolvedRolePermissions(
  config: AppIdVerificationConfig,
  nowMs: number
): Promise<Readonly<Record<string, readonly string[]>>> {
  if (!config.rolesSource) {
    return ROLE_PERMISSIONS;
  }
  if (rolesCache !== null && nowMs - rolesCache.fetchedAtMs < ROLES_CACHE_TTL_MS) {
    return rolesCache.data;
  }

  const read = await readRolesDocument(config.rolesSource);
  if (read === null) {
    // A missing document (fresh database) and a failed read are both handled
    // the same way here: keep serving whatever cache exists, and only a
    // deployment that has *never once* resolved successfully falls all the
    // way back to the literal table. A transient blip must not suddenly
    // narrow every caller's permissions to nothing.
    return rolesCache?.data ?? ROLE_PERMISSIONS;
  }
  rolesCache = { data: read, fetchedAtMs: nowMs };
  return read;
}

/** `null` covers both "no document yet" and "the read itself failed" — same one-null contract as the rest of this file. */
async function readRolesDocument(source: RolesReader): Promise<Readonly<Record<string, readonly string[]>> | null> {
  try {
    const result = await source.read(ROLES_DOC_ID);
    if (result === null) {
      return null;
    }
    return isRolesShape(result.document.roles) ? result.document.roles : null;
  } catch (error) {
    console.error('[pos-api] shared roles read failed', error);
    return null;
  }
}

/** Every value must be an array of strings — anything else is not a roles document this file trusts. */
function isRolesShape(value: unknown): value is Readonly<Record<string, readonly string[]>> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  return Object.values(value).every(
    (entry) => Array.isArray(entry) && entry.every((item) => typeof item === 'string')
  );
}

async function resolveAppIdScopes(
  rawScope: unknown,
  config: AppIdVerificationConfig,
  nowSeconds: number
): Promise<{ roles: string[]; permissions: string[] }> {
  const scopes = typeof rawScope === 'string' ? rawScope.split(/\s+/).filter(Boolean) : [];
  const rolePermissions = await resolvedRolePermissions(config, nowSeconds * 1000);
  const permissions = new Set<string>();
  const roles: string[] = [];

  for (const scope of scopes) {
    const granted = rolePermissions[scope];
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
    console.error('[pos-api] App ID JWKS fetch failed', error);
    return null;
  }
  if (!response.ok) {
    console.error(`[pos-api] App ID JWKS fetch returned ${response.status}`);
    return null;
  }
  try {
    const data = (await response.json()) as { keys?: Jwk[] };
    return data.keys ?? [];
  } catch (error) {
    console.error('[pos-api] App ID JWKS response was not valid JSON', error);
    return null;
  }
}

/**
 * RSA signature check for an App ID access token. `createPublicKey` has taken a
 * JWK-shaped public key directly since Node v15.9, and `verify`'s synchronous
 * overload (no callback) returns a boolean rather than throwing on a bad
 * signature — only a malformed key or a malformed signature buffer throws,
 * both caught below and treated as "does not verify", not "crashes the process".
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
 * Constant-time signature comparison.
 *
 * `timingSafeEqual` throws on a length mismatch, so the lengths are compared first —
 * which leaks only the *length* of a forged signature, a value the attacker already
 * chose.
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

/**
 * Constant-time equality for two plain strings — same reasoning as
 * `signatureMatches` above, generalized: `GET /internal/roles` (`api.ts`)
 * compares a presented `X-Internal-Secret` header against `INTERNAL_API_SECRET`,
 * and a `===` there would leak the secret's matching-prefix length through
 * timing, the exact class of bug `timingSafeEqual` exists to close.
 */
export function constantTimeStringsEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  return left.length === right.length && timingSafeEqual(left, right);
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
