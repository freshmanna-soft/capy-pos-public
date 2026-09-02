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
 * 3. Route → 404.
 * 4. Body cap → 413, while the body streams. This is the *first* real limit an
 *    unauthenticated caller hits — there is no cheaper header check to put
 *    ahead of it, unlike the sibling services' auth-before-body-cap ordering.
 * 5. JSON → 400, `validate` → 400, then the App ID call itself.
 * 6. The App ID call's result is passed through **verbatim** — status and
 *    body alike — not folded into a fixed 200/502 pair. `relay()`'s contract
 *    (see its own doc comment) is to resolve with whatever App ID actually
 *    answered, success or a well-formed OAuth error alike, and only *throw*
 *    for a genuine transport failure. So a thrown error is the only case this
 *    boundary turns into a generic 502 — everything else is App ID's own
 *    answer, unedited.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { corsHeaders, originAllowed } from './cors.ts';

/** The one route this service serves. `OPTIONS` is the preflight for it. */
export const ALLOWED_METHODS = 'POST, OPTIONS';

/** What a validator returned when it refused the body. */
type Rejection = { readonly error: string };

export interface BoundaryConfig<TRequest> {
  /** Log prefix, e.g. `[appid-relay]`. Never sent to the caller. */
  readonly logPrefix: string;
  /** The one path served, e.g. `/appid/token`. Matched with `endsWith`. */
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
