/**
 * The transport boundary: the order the checks run in, and nothing else.
 *
 * ## Why this is its own module
 *
 * It used to be an anonymous callback inside `createServer(...)` in `server.ts`,
 * next to `requireConfig()` and `listen()`. That made it unreachable from a test —
 * importing `server.ts` binds a port and `process.exit(1)`s on an unset variable —
 * so the only assertions this repo had about the boundary were `readFileSync` plus
 * `assert.match` greps. QA's verdict on that was exact: inverting `if (!outcome.ok)`
 * or deleting the body-cap block left every test green. A boundary proven by grep is
 * the same defect epic #195 exists to fix, one layer up.
 *
 * Everything that varies between the two proxies — the route, the caps, the
 * validator, the downstream call — is a parameter, so this file has no import that
 * is not a Node builtin or `session-guard.ts`. Two consequences, both wanted:
 * `http.test.mjs` starts a real server and issues real requests with no model SDK
 * installed and no key in the environment, and the file is byte-identical in both
 * services, checked by the same drift assertion that guards `session-guard.ts`.
 *
 * ## The order, and why it is this order
 *
 * 1. `OPTIONS` → 204, *before* auth. A browser never sends `Authorization` on a
 *    preflight, so requiring a token here would refuse the very request that tells
 *    the browser it may send one. `corsHeaders` has already omitted
 *    `Allow-Origin` for an unlisted origin, which is what makes the browser refuse
 *    the real call.
 * 2. Origin → 403. A present-but-unlisted origin is refused outright rather than
 *    merely left without an allow header: omitting the header stops a compliant
 *    browser from *reading* the reply, but by then the hop has been taken and the
 *    model billed.
 * 3. Route → 404.
 * 4. Auth → 401/403/503, before a single body byte is read. Once App ID's RS256
 *    path was added to `session-guard.ts`, this stopped being purely a header
 *    check with "nothing to wait for": a JWKS cache miss is a real network call.
 *    The order is unchanged — auth still runs before the body is touched, and an
 *    unauthenticated caller still cannot make this process buffer megabytes — but
 *    the wait is why the body-reading listener is now attached from inside the
 *    same `await`ed async wrapper rather than before it. Node's `IncomingMessage`
 *    does not start flowing until something attaches a listener for incoming
 *    chunks (paused by default), so deferring that attachment behind the `await`
 *    drops no bytes.
 * 5. Body cap → 413, while the body streams. Needed *even though* auth ran first: an
 *    authenticated caller can still stream without bound, and the field caps inside
 *    `validate` are only consulted once the whole body is in memory.
 * 6. JSON → 400, `validate` → 400, then the downstream call: 200, or 502 with the
 *    real error in the log and out of the response.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { Permission, authorize, corsHeaders, originAllowed, type AppIdVerificationConfig } from './session-guard.ts';

/** Both proxies are one POST route. `OPTIONS` is the preflight for it. */
export const ALLOWED_METHODS = 'POST, OPTIONS';

/** What a validator returned when it refused the body. */
type Rejection = { readonly error: string };

export interface BoundaryConfig<TRequest> {
  /** Log prefix, e.g. `[vision]`. Never sent to the caller. */
  readonly logPrefix: string;
  /** The one path served, e.g. `/vision/identify`. Matched with `endsWith`. */
  readonly route: string;
  /** HS256 secret browser session tokens are verified against. */
  readonly secret: string;
  /** Omitted: this deployment verifies HS256 (`secret`) only — today's exact behaviour. */
  readonly appId?: AppIdVerificationConfig;
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
  /**
   * Injected so expiry is testable without faking a clock, the way `authorize` takes
   * `nowSeconds` for the same reason.
   */
  readonly nowSeconds?: () => number;
}

/**
 * Build the request listener. Hand it to `createServer`.
 *
 * Takes its configuration as an argument rather than reading `process.env`, so the
 * deployed path and the tested path are the same code with different values — not a
 * production path and a test-only shortcut that can drift.
 */
export function createRequestListener<TRequest>(
  config: BoundaryConfig<TRequest>
): (req: IncomingMessage, res: ServerResponse) => void {
  const clock = config.nowSeconds ?? ((): number => Math.floor(Date.now() / 1000));

  return (req, res) => {
    const origin = req.headers.origin;
    const cors = corsHeaders(origin, config.origins, ALLOWED_METHODS);

    const send = (status: number, body: unknown): void => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
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

    if (req.method !== 'POST' || !req.url?.split('?')[0]?.endsWith(config.route)) {
      send(404, { error: `POST ${config.route}` });
      return;
    }

    void (async () => {
      const outcome = await authorize(
        req.headers.authorization,
        Permission.PROCESS_SALE,
        { secret: config.secret, appId: config.appId },
        clock()
      );
      if (!outcome.ok) {
        send(outcome.status, { error: outcome.error });
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
          // Stop reading, then drop the socket once the reply is on the wire.
          // `req.destroy()` on the spot races the write and can cut the 413 the caller
          // needs in order to learn to send less.
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
            send(200, await config.handle(request));
          } catch (error) {
            // Never leak a model error, a key, or a stack to the till. The operator id
            // stays in the log so a 502 can be traced to a session.
            console.error(`${config.logPrefix} request failed`, { operatorId: outcome.claims.operatorId, error });
            send(502, { error: config.unavailable });
          }
        })();
      });
    })();
  };
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
