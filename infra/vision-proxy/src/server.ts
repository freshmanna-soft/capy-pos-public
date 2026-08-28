/**
 * The HTTP adapter and the process entry point.
 *
 * The same file serves local development and IBM Cloud Code Engine. That is the
 * whole point of this story: there is no gateway in front of the container to
 * delegate authorization to, so the check has to run here, and a dev-only shortcut
 * would be a second code path that can drift from the deployed one.
 *
 * Every decision lives in `session-guard.ts` and `identify.ts`; this file is sockets,
 * environment, and the order the checks run in.
 *
 *   SESSION_JWT_SECRET=… ALLOWED_ORIGINS=http://localhost:4200 \
 *   ANTHROPIC_API_KEY=… npm start                              # laptop, port 8787
 *
 * Then point a dev build at it: `features.aiVision = true`, `apiUrl =
 * 'http://localhost:8787'` and `visionApiPath = '/vision/identify'` in
 * `src/environments/environment.ts`.
 */
import { createServer } from 'node:http';
import { identify, validate, MAX_IMAGE_BYTES } from './identify.ts';
import { Permission, authorize, corsHeaders, originAllowed, readAllowedOrigins } from './session-guard.ts';

const PORT = Number(process.env['PORT'] ?? 8787);

/**
 * The largest body accepted, in bytes.
 *
 * Derived from `MAX_IMAGE_BYTES` rather than written as its own number so the two
 * cannot drift: a transport cap below the frame cap would reject frames `identify.ts`
 * considers legal. The slack covers the catalog and the JSON envelope around it.
 *
 * A cap is needed even though `authorize` runs first: an *authenticated* caller can
 * still stream without bound, and the frame cap inside `validate` is only consulted
 * once the whole body is in memory.
 */
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 512 * 1024;

const ALLOWED_METHODS = 'POST, OPTIONS';

/**
 * Fail before listening, not on the first request.
 *
 * `authorize` answers 503 for an empty secret, which is the right answer for an
 * environment that changed under a running process. It is the wrong answer for a
 * revision that was never configured: that should never accept traffic at all,
 * because a service 503-ing every call looks like an outage to page someone about
 * rather than a missing variable. Same reasoning, and same shape, as
 * `infra/pos-api/src/server.ts`.
 */
function requireConfig(): { secret: string; origins: readonly string[] } {
  const secret = process.env['SESSION_JWT_SECRET'] ?? '';
  if (secret.length === 0) {
    console.error(
      '[vision] SESSION_JWT_SECRET is not set. It must match the secret the browser signs ' +
        'sessions with (see src/app/core/infrastructure/auth/session-issuer.ts). Refusing to start.'
    );
    process.exit(1);
  }

  const origins = readAllowedOrigins(process.env['ALLOWED_ORIGINS']);
  if (origins.length === 0) {
    console.error(
      '[vision] ALLOWED_ORIGINS is not set. Give it a comma-separated list of browser ' +
        'origins (e.g. http://localhost:4200). Refusing to start: the alternative this ' +
        'replaces — Access-Control-Allow-Origin: * in front of a metered model — is the ' +
        'thing this service must not do.'
    );
    process.exit(1);
  }

  console.log(`[vision] origins: ${origins.join(', ')}`);
  return { secret, origins };
}

const { secret, origins } = requireConfig();

createServer((req, res) => {
  const origin = req.headers.origin;
  const cors = corsHeaders(origin, origins, ALLOWED_METHODS);

  const send = (status: number, body: unknown): void => {
    res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
  };

  // Preflight, before any auth: a browser never sends `Authorization` on an OPTIONS
  // probe, so requiring a token here would refuse the very request that tells the
  // browser it may send one. `corsHeaders` has already omitted `Allow-Origin` for an
  // unlisted origin, which is what makes the browser refuse the real call.
  if (req.method === 'OPTIONS') {
    res.writeHead(204, cors).end();
    return;
  }

  // A present-but-unlisted `Origin` is refused outright rather than merely left
  // without an allow header: omitting the header stops a compliant browser from
  // reading the reply, but by then the request has been served and the model billed.
  if (!originAllowed(origin, origins)) {
    send(403, { error: 'Origin is not allowed.' });
    return;
  }

  if (req.method !== 'POST' || !req.url?.split('?')[0]?.endsWith('/vision/identify')) {
    send(404, { error: 'POST /vision/identify' });
    return;
  }

  // Auth on headers, before a single body byte is read. The token is in a header, so
  // there is nothing to wait for — and an unauthenticated caller that cannot make
  // this process buffer a 3 MB frame is a cheaper thing to be pointed at.
  const outcome = authorize(req.headers.authorization, Permission.PROCESS_SALE, secret, Math.floor(Date.now() / 1000));
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
    if (received > MAX_BODY_BYTES) {
      aborted = true;
      send(413, { error: 'Request body too large.' });
      req.destroy();
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

      const request = validate(parsed);
      if ('error' in request) {
        send(400, { error: request.error });
        return;
      }

      try {
        send(200, await identify(request));
      } catch (error) {
        console.error('[vision] recognition failed', { operatorId: outcome.claims.operatorId, error });
        send(502, { error: 'Recognition is unavailable.' });
      }
    })();
  });
}).listen(PORT, () => {
  console.log(`[vision] listening on http://localhost:${PORT}/vision/identify`);
});

// Made with Bob
