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
 * Until story #207 this file *was* the boundary, and its only check was that a bearer
 * token was *present* — `Authorization: Bearer x` satisfied it — in front of a model
 * holding tools that change a cart. Its docblock said so, and told the reader not to
 * point an API Gateway route at it. That warning was true and useless: #207's whole
 * purpose is to point a route at it. So the route now has the same boundary the
 * container has, verified rather than documented, and
 * `terraform/aws-demo/ai-proxies.tf` binds the two variables it needs.
 *
 * ## What this does not make safe
 *
 * The signing secret is shared with a public browser bundle, so this bounds
 * *reachability*, not *identity* — the same limit `session-guard.ts` states at length,
 * and the reason issue #206's gateway authorizer is still worth having in front of
 * this. It matters doubly here: a hop can add a line to a cart, so an admitted caller
 * is one that could have used the till anyway, and nothing more.
 *
 *   SESSION_JWT_SECRET   must match getJwtSecret() in session-issuer.ts
 *   ALLOWED_ORIGINS      comma-separated browser origins; there is no wildcard
 *   ANTHROPIC_API_KEY    read by relay.ts, from Secrets Manager, never a literal
 *
 * Handler: `dist/lambda.handler`, runtime nodejs22.x.
 */
import { MAX_BODY_BYTES, validate } from './validate.ts';
import { relay } from './relay.ts';
import { createProxyHandler, readProxyEnvironment } from './proxy-handler.ts';

const LOG_PREFIX = '[clerk-agent]';

const ROUTE = '/clerk/agent';

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
  handle: relay,
  unavailable: 'The clerk is unavailable.',
});

// Made with Bob
