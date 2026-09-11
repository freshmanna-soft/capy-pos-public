/**
 * The transport boundary: the order the checks run in, and nothing else.
 *
 * Shaped after `infra/clerk-agent-relay/src/http.ts` — same module split, same
 * reason for it (a boundary proven only by grepping `server.ts` is the exact
 * defect epic #195 exists to fix) — with the one structural difference this
 * service's purpose forces: **there is no `authorize()` step.** The sibling
 * proxies require a valid session bearer token before they will spend a model
 * call on a caller's behalf; this service's entire job is answering callers who
 * do not have a session yet. Requiring one here would make signing in
 * impossible — there would be no way to ever obtain the token this route is
 * supposed to hand out.
 *
 * ## The order, and why it is this order
 *
 * 1. `OPTIONS` → 204, before anything else. Same reasoning as the sibling
 *    services: a preflight never carries the real request's body or headers.
 * 2. Origin → 403, refused outright rather than merely left without an allow
 *    header — by the time a compliant browser would refuse to *read* an
 *    unlisted origin's reply, the request has already spent a login attempt
 *    against the real App ID tenant. Refusing before the route match closes
 *    that gap regardless of path.
 * 3. Route → 404 — the path matched exactly, and the method with it.
 *    `server.ts` dispatches from an explicit table (`routes.ts`) that has
 *    already matched this path, but this boundary is exercised in tests
 *    without that table, so it keeps its own check rather than trusting a
 *    caller to have routed correctly.
 * 4. `rateLimit` → 429 with `Retry-After`, for the boundaries that configure one
 *    (`/appid/customer/sign-up` only — see `rate-limit.ts`). *After* the route
 *    match, so a caller cannot spend someone's budget by hammering a path this
 *    boundary does not serve; *before* the body is read, so a refused caller
 *    costs a header check rather than a body, a parse and an App ID call. Which
 *    also means the counter cannot depend on the body: the decision is taken
 *    before the email is even known, so a 429 looks identical whether that
 *    address has an account or not (#253's anti-enumeration property, which the
 *    generic `tooManyRequests` string keeps). It is the third of the three
 *    refusals answered before the body is read (403, 404, 429), and all three go
 *    out through the same `send`, so none of them can quietly grow handling that
 *    the other two lack.
 * 5. Body cap → 413, while the body streams. The first real limit an
 *    unauthenticated caller hits on a route with no limiter — there is no cheaper
 *    header check to put ahead of it, unlike the sibling services'
 *    auth-before-body-cap ordering.
 * 6. JSON → 400, `validate` → 400, then the App ID call itself.
 * 7. The App ID call's result is passed through **verbatim** — status and
 *    body alike — not folded into a fixed 200/502 pair. `relay()`'s contract
 *    (see its own doc comment) is to resolve with whatever App ID actually
 *    answered, success or a well-formed OAuth error alike, and only *throw*
 *    for a genuine transport failure. So a thrown error is the only case this
 *    boundary turns into a generic 502 — everything else is App ID's own
 *    answer, unedited.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { corsHeaders, originAllowed } from './cors.ts';
import { requestPath } from './routes.ts';

/** The one route this service serves. `OPTIONS` is the preflight for it. */
export const ALLOWED_METHODS = 'POST, OPTIONS';

/**
 * The 429 body when a boundary configures `rateLimit` but no message. Names the
 * limit and nothing about the request — see `tooManyRequests`.
 */
export const DEFAULT_TOO_MANY_REQUESTS = 'Too many requests. Please try again later.';

/** What a validator returned when it refused the body. */
type Rejection = { readonly error: string };

export interface BoundaryConfig<TRequest> {
  /** Log prefix, e.g. `[appid-relay]`. Never sent to the caller. */
  readonly logPrefix: string;
  /**
   * The one path served, e.g. `/appid/token`. Matched **exactly**, not with
   * `endsWith`: `server.ts` now dispatches from an explicit table (`routes.ts`)
   * that already matched this path exactly, so a looser check here could only
   * ever disagree with it — and on its own it would serve `/anything/appid/token`.
   */
  readonly route: string;
  /** Browser origins that may be answered. Never a wildcard. */
  readonly origins: readonly string[];
  /** Transport cap, above the service's own field caps so it cannot reject a legal body. */
  readonly maxBodyBytes: number;
  /** Refuses or narrows the parsed body. Pure. */
  readonly validate: (body: unknown) => TRequest | Rejection;
  /** The App ID call. Resolves with App ID's real status+body; throws only on transport failure. */
  readonly handle: (request: TRequest) => Promise<{ readonly status: number; readonly body: unknown }>;
  /** The 502 body for a genuine transport failure. Says nothing about why. */
  readonly unavailable: string;
  /**
   * Optional per-client limiter, consulted once per real request. Omitted by
   * every boundary but customer sign-up — see `rate-limit.ts` for why the token
   * routes deliberately have none.
   */
  readonly rateLimit?: (req: IncomingMessage) => {
    readonly allowed: boolean;
    readonly retryAfterSeconds: number;
  };
  /**
   * The 429 body, for a boundary that configures `rateLimit`. Must stay generic:
   * it is sent before the body is parsed, and saying anything about the request
   * would be the one place this route could leak whether an email is already
   * registered.
   */
  readonly tooManyRequests?: string;
}

/**
 * Build the request listener. Hand it to `createServer`.
 *
 * Takes its configuration as an argument rather than reading `process.env`, so
 * the deployed path and the tested path are the same code with different
 * values — same convention as the sibling services.
 */
export function createRequestListener<TRequest>(
  config: BoundaryConfig<TRequest>
): (req: IncomingMessage, res: ServerResponse) => void {
  return (req, res) => {
    const origin = req.headers.origin;
    const cors = corsHeaders(origin, config.origins, ALLOWED_METHODS);

    // `extraHeaders` exists for exactly one caller (the 429's `Retry-After`), so
    // that refusal is the same two lines as the 403 and 404 rather than a
    // hand-rolled `writeHead`/`end` pair that can drift from them.
    const send = (status: number, body: unknown, extraHeaders: Record<string, string> = {}): void => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json', ...extraHeaders });
      res.end(JSON.stringify(body));
    };

    if (req.method === 'OPTIONS') {
      res.writeHead(204, cors).end();
      return;
    }

    if (!originAllowed(origin, config.origins)) {
      send(403, { error: 'Origin is not allowed.' });
      return;
    }

    if (req.method !== 'POST' || requestPath(req.url) !== config.route) {
      send(404, { error: `POST ${config.route}` });
      return;
    }

    const limit = config.rateLimit?.(req);
    if (limit !== undefined && !limit.allowed) {
      // Structurally identical to the 403 and 404 above, deliberately: all three
      // answer before the body is read, and none of them drains it. Node's server
      // discards an unconsumed request body once the response finishes, so there
      // is nothing left in flight to stall the socket — asserted rather than
      // assumed, with a body far larger than any socket buffer, at all three
      // refusals (`http.test.mjs`, `rate-limit.test.mjs`). The 413 below is the
      // one that destroys instead, because there the body is being read and the
      // point is to stop reading it.
      send(429, { error: config.tooManyRequests ?? DEFAULT_TOO_MANY_REQUESTS }, {
        'Retry-After': String(limit.retryAfterSeconds),
      });
      return;
    }

    const chunks: Buffer[] = [];
    let received = 0;
    let aborted = false;

    req.on('data', (chunk: Buffer) => {
      if (aborted) {
        return;
      }
      received += chunk.length;
      if (received > config.maxBodyBytes) {
        aborted = true;
        send(413, { error: 'Request body too large.' });
        req.pause();
        res.on('finish', () => req.destroy());
        return;
      }
      chunks.push(chunk);
    });

    req.on('end', () => {
      if (aborted) {
        return;
      }
      void (async () => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          send(400, { error: 'Body must be JSON.' });
          return;
        }

        const request = config.validate(parsed);
        if (isRejection(request)) {
          send(400, { error: request.error });
          return;
        }

        try {
          const result = await config.handle(request);
          send(result.status, result.body);
        } catch (error) {
          // A transport failure, not an OAuth answer — nothing here is safe to
          // pass through (could be a raw network error, a stack, or worse).
          console.error(`${config.logPrefix} request failed`, error);
          send(502, { error: config.unavailable });
        }
      })();
    });
  };
}

/** Whether a validator refused. Mirrors the same predicate in the sibling proxies. */
function isRejection<TRequest>(result: TRequest | Rejection): result is Rejection {
  return (
    typeof result === 'object' &&
    result !== null &&
    'error' in result &&
    typeof (result as Rejection).error === 'string'
  );
}
