/**
 * The process entry point: environment, sockets, and nothing that decides anything.
 *
 * The same file serves local development and IBM Cloud Code Engine. That is the
 * whole point of this story: there is no gateway in front of the container to
 * delegate authorization to, so the check has to run here, and a dev-only shortcut
 * would be a second code path that can drift from the deployed one.
 *
 * The boundary matters more on this route than on the vision proxy's: this endpoint
 * holds tools that change a cart, so anything that can reach this port can spend the
 * shop's model key *and* drive the till. The order the checks run in lives in
 * `http.ts`, which is where the suite can start a real server and issue real requests
 * at it; the decisions live in `session-guard.ts`, `validate.ts` and `relay.ts`. What
 * is left here is the two things a test cannot have: a bound port and a
 * `process.exit`.
 *
 *   SESSION_JWT_SECRET=… ALLOWED_ORIGINS=http://localhost:4200 \
 *   ANTHROPIC_API_KEY=… npm start                              # laptop, port 8789
 *
 * Then set `features.clerkAgent = true` and `clerkAgentApiUrl =
 * 'http://localhost:8789/clerk/agent'` in the environment file you are serving.
 */
import { createServer } from 'node:http';
import { relay } from './relay.ts';
import { validate, MAX_TRANSCRIPT_CHARS } from './validate.ts';
import { createRequestListener } from './http.ts';
import { readAllowedOrigins } from './session-guard.ts';

const PORT = Number(process.env['PORT'] ?? 8789);

const ROUTE = '/clerk/agent';

/**
 * The largest body accepted, in bytes.
 *
 * Derived from `MAX_TRANSCRIPT_CHARS` rather than written as its own number so the
 * two cannot drift: a transport cap below the transcript cap would reject transcripts
 * `validate.ts` considers legal. The slack covers the catalog, the cart and the JSON
 * envelope around them.
 */
const MAX_BODY_BYTES = MAX_TRANSCRIPT_CHARS + 64 * 1024;

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
      '[clerk-agent] SESSION_JWT_SECRET is not set. It must match the secret the browser signs ' +
        'sessions with (see src/app/core/infrastructure/auth/session-issuer.ts). Refusing to start.'
    );
    process.exit(1);
  }

  const origins = readAllowedOrigins(process.env['ALLOWED_ORIGINS']);
  if (origins.length === 0) {
    console.error(
      '[clerk-agent] ALLOWED_ORIGINS is not set. Give it a comma-separated list of browser ' +
        'origins (e.g. http://localhost:4200). Refusing to start: the alternative this ' +
        'replaces — Access-Control-Allow-Origin: * in front of a tool-capable model on the ' +
        "shop's key — is the thing this service must not do."
    );
    process.exit(1);
  }

  console.log(`[clerk-agent] origins: ${origins.join(', ')}`);
  return { secret, origins };
}

const { secret, origins } = requireConfig();

createServer(
  createRequestListener({
    logPrefix: '[clerk-agent]',
    route: ROUTE,
    secret,
    origins,
    maxBodyBytes: MAX_BODY_BYTES,
    validate,
    handle: relay,
    unavailable: 'The clerk is unavailable.',
  })
).listen(PORT, () => {
  console.log(`[clerk-agent] listening on http://localhost:${PORT}${ROUTE}`);
});

// Made with Bob
