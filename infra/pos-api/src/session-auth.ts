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
 * wrongly.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';

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
 * Verify the bearer token and check one permission.
 *
 * `required` of `null` means "authentication only, no specific permission" — used by
 * nothing today, but the distinction is what keeps `/api/health` (which skips this
 * function entirely) from being confused with an authenticated-but-unprivileged
 * route.
 *
 * `nowSeconds` is a parameter rather than a `Date.now()` call so expiry is testable
 * without waiting or faking the clock, the same way `retry.service.spec.ts` treats
 * time in the Angular app.
 */
export function authorize(
  authorization: string | undefined,
  required: Permission | null,
  secret: string,
  nowSeconds: number
): AuthOutcome {
  // Fail closed, loudly, on a misconfigured deployment. `server.ts` refuses to
  // start without the secret, so reaching this means the env changed underneath a
  // running process — a 503 says "this service is broken", which is true, rather
  // than 401 "your token is bad", which is not.
  if (secret.length === 0) {
    return { ok: false, status: 503, error: 'Auth is not configured.' };
  }

  const token = readBearer(authorization);
  if (token === null) {
    return { ok: false, status: 401, error: 'Authorization required.' };
  }

  const claims = verifySessionToken(token, secret, nowSeconds);
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
