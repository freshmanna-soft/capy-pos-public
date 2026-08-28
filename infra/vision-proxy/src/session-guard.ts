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
import { createHmac, timingSafeEqual } from 'node:crypto';

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

/**
 * Verify the bearer token and check one permission.
 *
 * `nowSeconds` is a parameter rather than a `Date.now()` call so expiry is testable
 * without faking a clock, the way `retry.service.spec.ts` treats time in the Angular
 * app.
 */
export function authorize(
  authorization: string | undefined,
  required: Permission | null,
  secret: string,
  nowSeconds: number
): AuthOutcome {
  // Fail closed and loudly on a misconfigured deployment. `server.ts` refuses to
  // start without a secret, so reaching this means the environment changed under a
  // running process: 503 "this service is broken" is true, 401 "your token is bad"
  // is not.
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
    // what they lack is a usable error rather than an oracle.
    return { ok: false, status: 403, error: `Requires ${required}.` };
  }

  return { ok: true, claims };
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
