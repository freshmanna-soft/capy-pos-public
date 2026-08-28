/**
 * The process entry point: environment, sockets, and nothing that decides anything.
 *
 * The same file serves local development and IBM Cloud Code Engine. That is the
 * whole point of this story: there is no gateway in front of the container to
 * delegate authorization to, so the check has to run here, and a dev-only shortcut
 * would be a second code path that can drift from the deployed one.
 *
 * The order the checks run in lives in `http.ts`, which is where the suite can start
 * a real server and issue real requests at it; the decisions live in
 * `session-guard.ts` and `identify.ts`. What is left here is the two things a test
 * cannot have: a bound port and a `process.exit`.
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
import { createRequestListener } from './http.ts';
import { readAllowedOrigins } from './session-guard.ts';

const PORT = Number(process.env['PORT'] ?? 8787);

const ROUTE = '/vision/identify';

/**
 * The largest body accepted, in bytes.
 *
 * Derived from `MAX_IMAGE_BYTES` rather than written as its own number so the two
 * cannot drift: a transport cap below the frame cap would reject frames `identify.ts`
 * considers legal. The slack covers the catalog and the JSON envelope around it.
 */
const MAX_BODY_BYTES = MAX_IMAGE_BYTES + 512 * 1024;

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

createServer(
  createRequestListener({
    logPrefix: '[vision]',
    route: ROUTE,
    secret,
    origins,
    maxBodyBytes: MAX_BODY_BYTES,
    validate,
    handle: identify,
    unavailable: 'Recognition is unavailable.',
  })
).listen(PORT, () => {
  console.log(`[vision] listening on http://localhost:${PORT}${ROUTE}`);
});

// Made with Bob
