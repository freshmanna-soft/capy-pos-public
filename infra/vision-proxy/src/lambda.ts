/**
 * The AWS entry point: environment, one exported function, and nothing that decides
 * anything.
 *
 * This is `server.ts` for a gateway instead of a socket. Every check — the allow-list,
 * the session token, the `sale:process` permission, the body cap, the ordering between
 * them — lives in `proxy-handler.ts`, which is byte-identical in both proxies and
 * exercised by `proxy-handler.test.mjs`. What is left here is the two things that file
 * cannot have: the real environment, and the symbol the runtime imports.
 *
 * ## What changed, and why this file used to carry a warning
 *
 * Until story #207 this file *was* the boundary, and it had no authorization at all:
 * its docblock said so, and told the reader not to point an API Gateway route at it.
 * That warning was true and useless — #207's whole purpose is to point a route at it.
 * So the route now has the same boundary the container has, verified rather than
 * documented, and `terraform/aws-demo/ai-proxies.tf` binds the two variables it needs.
 *
 * ## What this does not make safe
 *
 * The signing secret is shared with a public browser bundle, so this bounds
 * *reachability*, not *identity* — the same limit `session-guard.ts` states at length,
 * and the reason issue #206's gateway authorizer is still worth having in front of
 * this. It stops unauthenticated callers, scanners and cross-origin pages from
 * spending the shop's model budget; it does not stop someone who has read the bundle.
 *
 *   SESSION_JWT_SECRET   must match getJwtSecret() in session-issuer.ts
 *   ALLOWED_ORIGINS      comma-separated browser origins; there is no wildcard
 *   ANTHROPIC_API_KEY    read by identify.ts, from Secrets Manager, never a literal
 *
 * Handler: `dist/lambda.handler`, runtime nodejs22.x.
 */
import { MAX_BODY_BYTES, identify, validate } from './identify.ts';
import { createProxyHandler, readProxyEnvironment } from './proxy-handler.ts';

const LOG_PREFIX = '[vision]';

const ROUTE = '/vision/identify';

/**
 * Read at module scope, so a missing variable fails the function's *init* rather than
 * every request. Same reasoning as `server.ts` refusing to `listen`: a service that
 * 503s every call looks like an outage to page someone about, where an init error
 * names the variable in the log and in the console's own error message.
 */
const { secret, origins } = readProxyEnvironment(process.env, LOG_PREFIX);

export const handler = createProxyHandler({
  logPrefix: LOG_PREFIX,
  route: ROUTE,
  secret,
  origins,
  maxBodyBytes: MAX_BODY_BYTES,
  validate,
  handle: identify,
  unavailable: 'Recognition is unavailable.',
});

// Made with Bob
