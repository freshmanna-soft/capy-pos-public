/**
 * Lambda: API Gateway REQUEST authorizer (issue #206)
 *
 * Responsibility: reject requests that do not present the shared service token.
 * Attached to every route except `GET /api/health`.
 *
 * This is an *interim* control, and it is worth being precise about what it does
 * and does not buy. It stops an anonymous caller who has found the gateway
 * hostname from reading the catalog (which carries cost prices) or writing
 * products and transactions — which is what #206 filed: the stack shipped with no
 * authorizer at all. It is not per-user auth and it cannot identify an operator;
 * one token is shared by every client, so it authenticates the *deployment*, not
 * the person. Real staff identity is the Cognito/switchability decision (#200),
 * deliberately out of scope here.
 *
 * Notes on the two ways an authorizer like this usually goes wrong:
 *
 *  - Failing open. If `API_SERVICE_TOKEN` is unset or blank the handler denies
 *    rather than waving the request through, so a half-configured deploy is
 *    closed rather than public. The Terraform variable has no default for the
 *    same reason.
 *  - Leaking the token through timing. The comparison is constant-time over
 *    SHA-256 digests, so it neither short-circuits on the first wrong byte nor
 *    reveals the expected length (`timingSafeEqual` throws on length mismatch,
 *    which is itself a signal; hashing first makes both sides 32 bytes).
 *
 * Intentionally dependency-free: no shared/ copy and no Lambda layer. This runs in
 * front of every request, so anything it imports is a new way for the whole API to
 * start 500ing, and `shared/logger.js` pulls in `@opentelemetry/api` from the layer.
 */

const { createHash, timingSafeEqual } = require('node:crypto');

/** Structured CloudWatch line, matching shared/logger.js's shape without its deps. */
function log(level, message, data = {}) {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...data,
      awsTraceId: process.env._X_AMZN_TRACE_ID,
    })
  );
}

/** Compare two secrets without leaking their contents or length via timing. */
function secretsMatch(a, b) {
  const digest = (value) => createHash('sha256').update(value, 'utf8').digest();
  return timingSafeEqual(digest(a), digest(b));
}

/** `Bearer <token>` → `<token>`. A bare token is accepted too. */
function extractToken(header) {
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return (match ? match[1] : header).trim();
}

exports.handler = async (event) => {
  const expected = process.env.API_SERVICE_TOKEN || '';

  if (expected === '') {
    // Deny, loudly. This is a deployment fault, not a caller fault, and it is the
    // one case where the API being unusable is the correct outcome.
    log('error', 'Authorizer denied: API_SERVICE_TOKEN is not configured');
    return { isAuthorized: false };
  }

  // API Gateway's 2.0 payload lowercases header names. `identity_sources` already
  // 401s a request with no Authorization header before the Lambda is invoked, so
  // this is a defence-in-depth branch rather than the primary path.
  const presented = event.headers?.authorization ?? event.headers?.Authorization ?? '';

  if (presented === '') {
    log('warn', 'Authorizer denied: no Authorization header', { route: event.routeKey });
    return { isAuthorized: false };
  }

  const isAuthorized = secretsMatch(extractToken(presented), expected);

  log(isAuthorized ? 'info' : 'warn', `Authorizer ${isAuthorized ? 'allowed' : 'denied'}`, {
    route: event.routeKey,
    // Never log the presented token, not even truncated — a prefix plus a retry
    // is an oracle.
    sourceIp: event.requestContext?.http?.sourceIp,
  });

  return { isAuthorized };
};
