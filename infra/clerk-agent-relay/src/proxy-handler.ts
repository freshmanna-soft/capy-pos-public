/**
 * The API Gateway boundary: the order the checks run in, and nothing else.
 *
 * ## Why this file exists
 *
 * `lambda.ts` used to *be* the boundary, and it was a worse one than the container's.
 * The vision proxy's handler had no authorization of any kind; the relay's checked
 * that a bearer token was *present* (`Authorization: Bearer x` satisfied it) in front
 * of a model holding tools that change a cart. Both docblocks said the same thing —
 * do not put this behind an API Gateway route — which is an honest warning and a
 * useless one: story #207 exists to put them behind exactly that.
 *
 * So the fix is not a warning, it is the check. This file is to `lambda.ts` what
 * `http.ts` is to `server.ts`: the transport boundary, taking everything that varies
 * between the two services as a parameter, so both entry points are wiring and the
 * decisions live in one tested place. It is byte-identical in both services, checked
 * by the same drift assertion in `session-guard.test.mjs` that guards `http.ts`.
 *
 * ## Why not reuse `http.ts` itself
 *
 * `http.ts` reads a body off a socket — `req.on('data')`, a running byte count, a
 * `req.destroy()` after the 413 is on the wire. A proxy event has no socket: the body
 * arrives already buffered (and possibly base64-encoded) as a string, and the reply is
 * a return value rather than a write. Sharing one module would mean a fake
 * `IncomingMessage`, which is a test double in production code. The *order* is what
 * matters and the order is shared, by being written once here and asserted against
 * `http.ts`'s in the suite.
 *
 * ## The order, and why it is this order
 *
 * 1. `OPTIONS` → 204, *before* auth. A browser never sends `Authorization` on a
 *    preflight, so requiring a token here would refuse the request that tells the
 *    browser it may send one.
 * 2. Origin → 403. A present-but-unlisted origin is refused outright, not merely left
 *    without an allow header. This matters more here than on the socket: HTTP API's
 *    own `cors_configuration` *replaces* the headers a Lambda returns, so on AWS the
 *    allow-list is only enforced if the function refuses the call itself.
 * 3. Path → 404, when the event carries one. The gateway route already matched, so
 *    this only catches a `$default`/`{proxy+}` integration pointed here by mistake.
 * 4. Method → 405. Both services are one POST route.
 * 5. Auth → 401/403/503, before the body is looked at. Cheapest check first, same as
 *    on the socket — and on Lambda there is a second reason: a refusal that never
 *    decodes, parses or validates a 3MB frame is a refusal that costs a few
 *    milliseconds of billed duration instead of a few hundred.
 * 6. Body cap → 413. Needed even though auth ran first: an authenticated caller can
 *    still send a body far above the field caps `validate` enforces once it is parsed.
 * 7. JSON → 400, `validate` → 400, then the downstream call: 200, or 502 with the real
 *    error in the log and out of the response.
 */
import { Permission, authorize, corsHeaders, originAllowed, readAllowedOrigins } from './session-guard.ts';
import { ALLOWED_METHODS } from './http.ts';

/**
 * The bits of an API Gateway proxy event these services read.
 *
 * Declared here rather than depending on `@types/aws-lambda`: two fields of the v1
 * shape and three of the v2 one is not worth a dependency in an image that otherwise
 * carries only the model SDK, and the narrow interface documents exactly what the
 * boundary trusts.
 */
export interface ProxyEvent {
  readonly body?: string | null;
  readonly isBase64Encoded?: boolean;
  readonly headers?: Record<string, string | undefined>;
  /** v1 (REST) carries the method here… */
  readonly httpMethod?: string;
  readonly path?: string;
  /** …v2 (HTTP API) here. */
  readonly requestContext?: { readonly http?: { readonly method?: string; readonly path?: string } };
  readonly rawPath?: string;
}

export interface ProxyResult {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/** What a validator returned when it refused the body. */
type Rejection = { readonly error: string };

export interface ProxyBoundaryConfig<TRequest> {
  /** Log prefix, e.g. `[vision]`. Never sent to the caller. */
  readonly logPrefix: string;
  /** The one path served, e.g. `/vision/identify`. Matched with `endsWith`. */
  readonly route: string;
  /** HS256 secret browser session tokens are verified against. */
  readonly secret: string;
  /** Browser origins that may be answered. Never a wildcard. */
  readonly origins: readonly string[];
  /** Transport cap, above the service's own field caps so it cannot reject a legal body. */
  readonly maxBodyBytes: number;
  /** Refuses or narrows the parsed body. Pure. */
  readonly validate: (body: unknown) => TRequest | Rejection;
  /** The metered call. Everything before it is what decides whether it happens. */
  readonly handle: (request: TRequest) => Promise<unknown>;
  /** The 502 body. Says nothing about why — the caller can do nothing with it. */
  readonly unavailable: string;
  /** Injected so expiry is testable without faking a clock, as `authorize` takes it. */
  readonly nowSeconds?: () => number;
}

/**
 * What a deployed proxy needs from its environment, and refuses to run without.
 *
 * The same two variables `server.ts` checks before it binds a port, read by the same
 * parser, so a Lambda and a container disagreeing about their configuration is not a
 * thing that can happen.
 */
export interface ProxyEnvironment {
  readonly secret: string;
  readonly origins: readonly string[];
}

/**
 * Read and validate the deployment's configuration, or throw.
 *
 * A throw at module scope is the Lambda equivalent of `server.ts`'s `process.exit(1)`:
 * the init fails, the function never serves the request, and the reason is in the log
 * with the variable's name in it. The alternative — letting `authorize` answer 503 for
 * an empty secret — turns a variable somebody forgot into an outage somebody pages
 * about, which is the reasoning `server.ts` already spells out.
 *
 * Takes an environment record rather than reading `process.env`, so the suite can
 * exercise every refusal without mutating global state.
 */
export function readProxyEnvironment(
  env: Record<string, string | undefined>,
  logPrefix: string
): ProxyEnvironment {
  const secret = env['SESSION_JWT_SECRET'] ?? '';
  if (secret.length === 0) {
    throw new Error(
      `${logPrefix} SESSION_JWT_SECRET is not set. It must match the secret the browser signs ` +
        'sessions with (see src/app/core/infrastructure/auth/session-issuer.ts). Refusing to serve.'
    );
  }

  // The guard's own parser, so `readProxyEnvironment` has no second idea of what the
  // variable means: the same trailing-slash stripping and deduplication the container
  // applies, because the two read the same Terraform value.
  const origins = readAllowedOrigins(env['ALLOWED_ORIGINS']);
  if (origins.length === 0) {
    throw new Error(
      `${logPrefix} ALLOWED_ORIGINS is not set. Give it a comma-separated list of browser ` +
        'origins (e.g. https://till.example.com). Refusing to serve: an API Gateway ' +
        "cors_configuration of allow_origins = [\"*\"] in front of a metered model is the " +
        'thing this boundary must not become.'
    );
  }

  return { secret, origins };
}

/**
 * Build the handler. Export what it returns as the function's `handler`.
 *
 * Takes its configuration as an argument rather than reading `process.env`, so the
 * deployed path and the tested path are the same code with different values — not a
 * production path and a test-only shortcut that can drift.
 */
export function createProxyHandler<TRequest>(
  config: ProxyBoundaryConfig<TRequest>
): (event: ProxyEvent) => Promise<ProxyResult> {
  const clock = config.nowSeconds ?? ((): number => Math.floor(Date.now() / 1000));

  return async (event: ProxyEvent): Promise<ProxyResult> => {
    const origin = readHeader(event, 'origin');
    // Sent on every reply, including the refusals. On AWS, HTTP API replaces these
    // when the API declares its own `cors_configuration` — which is why step 2 below
    // *refuses* an unlisted origin rather than trusting a header to stop it. They are
    // still correct for a function invoked directly, or fronted by a gateway that
    // passes them through.
    const cors = corsHeaders(origin, config.origins, ALLOWED_METHODS);

    const reply = (statusCode: number, body: unknown): ProxyResult => ({
      statusCode,
      headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      body: JSON.stringify(body),
    });

    const method = event.requestContext?.http?.method ?? event.httpMethod;

    if (method === 'OPTIONS') {
      return { statusCode: 204, headers: cors, body: '' };
    }

    if (!originAllowed(origin, config.origins)) {
      return reply(403, { error: 'Origin is not allowed.' });
    }

    // Only when the event names a path: a v1 event on a fixed route may not, and
    // inventing a 404 for a route the gateway already matched would be a refusal with
    // no cause.
    const path = event.requestContext?.http?.path ?? event.rawPath ?? event.path;
    if (typeof path === 'string' && !path.split('?')[0]?.endsWith(config.route)) {
      return reply(404, { error: `POST ${config.route}` });
    }

    if (method !== undefined && method !== 'POST') {
      return reply(405, { error: 'Use POST.' });
    }

    const outcome = authorize(readHeader(event, 'authorization'), Permission.PROCESS_SALE, config.secret, clock());
    if (!outcome.ok) {
      return reply(outcome.status, { error: outcome.error });
    }

    let raw: string;
    try {
      raw = decodeBody(event);
    } catch {
      // A body flagged base64 that is not base64. Not JSON, and never will be.
      return reply(400, { error: 'Body must be JSON.' });
    }

    if (Buffer.byteLength(raw, 'utf8') > config.maxBodyBytes) {
      // After auth, before parsing: the cap exists so an oversized body is refused
      // without being decoded into objects first.
      return reply(413, { error: 'Request body too large.' });
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return reply(400, { error: 'Body must be JSON.' });
    }

    const request = config.validate(parsed);
    if (isRejection(request)) {
      return reply(400, { error: request.error });
    }

    try {
      return reply(200, await config.handle(request));
    } catch (error) {
      // Never leak a model error, a key, or a stack to the till. The operator id stays
      // in the log so a 502 can be traced to a session.
      console.error(`${config.logPrefix} request failed`, { operatorId: outcome.claims.operatorId, error });
      return reply(502, { error: config.unavailable });
    }
  };
}

/**
 * One header, case-insensitively.
 *
 * HTTP API (payload v2) lowercases header names; REST (v1) passes them through as the
 * client sent them, so `Authorization` and `authorization` both arrive in the wild. A
 * boundary that only reads one casing is a boundary a caller can skip by changing a
 * letter.
 */
function readHeader(event: ProxyEvent, name: string): string | undefined {
  const headers = event.headers;
  if (headers === undefined || headers === null) {
    return undefined;
  }
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === wanted) {
      return typeof value === 'string' ? value : undefined;
    }
  }
  return undefined;
}

/** The request body as text, decoding the base64 the gateway may have wrapped it in. */
function decodeBody(event: ProxyEvent): string {
  const body = event.body;
  if (typeof body !== 'string' || body.length === 0) {
    return '';
  }
  if (event.isBase64Encoded !== true) {
    return body;
  }
  // `Buffer.from(…, 'base64')` never throws, it silently drops invalid characters, so
  // a round-trip check is what turns "not actually base64" into a 400 rather than a
  // mangled parse error.
  const decoded = Buffer.from(body, 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== body.replace(/[=\s]+$/, '')) {
    throw new Error('body is not base64');
  }
  return decoded.toString('utf8');
}

/**
 * Whether a validator refused.
 *
 * `'error' in request` inline would narrow wrongly for a `TRequest` that happens to
 * carry an `error` field; a type predicate keeps the check in one place and honest
 * about what it assumes — that a rejection is an object with a string `error`.
 */
function isRejection<TRequest>(result: TRequest | Rejection): result is Rejection {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    typeof (result as Rejection).error === 'string'
  );
}

// Made with Bob
