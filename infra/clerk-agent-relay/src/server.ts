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
 *
 * APPID_REGION/APPID_TENANT_ID/APPID_CLIENT_ID are optional — unset, this
 * verifies HS256 only, exactly as above. Set all three together to also accept
 * App ID's RS256 access tokens (see `session-guard.ts`'s own doc comment).
 */
import { createServer } from 'node:http';
import { relay } from './relay.ts';
import { validate, MAX_BODY_BYTES } from './validate.ts';
import { createRequestListener } from './http.ts';
import { readAllowedOrigins, type RolesSourceConfig } from './session-guard.ts';

const PORT = Number(process.env['PORT'] ?? 8789);

const ROUTE = '/clerk/agent';

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

/**
 * App ID verification is fully optional — three unset vars means exactly today's
 * HS256-only behaviour, not a misconfiguration. A *partial* set is refused the
 * same way an unset `SESSION_JWT_SECRET` is: "refuse to guess" rather than start
 * a revision that verifies RS256 tokens against the wrong tenant or audience.
 */
function readAppIdConfig():
  | { region: string; tenantId: string; audience: string; rolesSource?: RolesSourceConfig }
  | undefined {
  const region = process.env['APPID_REGION'] ?? '';
  const tenantId = process.env['APPID_TENANT_ID'] ?? '';
  const audience = process.env['APPID_CLIENT_ID'] ?? '';

  // "Configured at all" turns on `tenantId`/`audience` only, not `region`:
  // `region` has one sensible value across this whole estate (`us-south`) and
  // Terraform gives it a real default, so it is set on every deployment whether
  // or not App ID is actually wanted. Keying "unconfigured" off all three would
  // make that harmless default look like a *partial* App ID config and refuse
  // to start every deployment that has never touched these vars at all.
  if (tenantId.length === 0 && audience.length === 0) {
    return undefined;
  }
  if (tenantId.length === 0 || audience.length === 0 || region.length === 0) {
    console.error(
      '[clerk-agent] APPID_REGION, APPID_TENANT_ID and APPID_CLIENT_ID must be set together, ' +
        'or not at all. Refusing to start rather than verify App ID tokens against a partial config.'
    );
    process.exit(1);
  }
  return { region, tenantId, audience, rolesSource: readRolesSourceConfig() };
}

/**
 * Phase 5, RBAC centralization — optional, unlike App ID itself above: an
 * unset pair means `resolveAppIdScopes` (`session-guard.ts`) falls back to
 * its own literal `ROLE_PERMISSIONS` table, exactly today's behaviour. A
 * *partial* pair is refused the same way a partial App ID config is —
 * "refuse to guess" rather than fetch against a URL with no secret to
 * present, or a secret nothing will ever check.
 */
function readRolesSourceConfig(): RolesSourceConfig | undefined {
  const url = process.env['POS_API_INTERNAL_ROLES_URL'] ?? '';
  const secret = process.env['INTERNAL_API_SECRET'] ?? '';

  if (url.length === 0 && secret.length === 0) {
    return undefined;
  }
  if (url.length === 0 || secret.length === 0) {
    console.error(
      '[clerk-agent] POS_API_INTERNAL_ROLES_URL and INTERNAL_API_SECRET must be set together, or ' +
        'not at all. Refusing to start rather than fetch the shared roles document half-configured.'
    );
    process.exit(1);
  }
  return { url, secret };
}

const { secret, origins } = requireConfig();
const appId = readAppIdConfig();

createServer(
  createRequestListener({
    logPrefix: '[clerk-agent]',
    route: ROUTE,
    secret,
    appId,
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
