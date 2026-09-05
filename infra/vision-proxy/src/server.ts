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
 *
 * APPID_REGION/APPID_TENANT_ID/APPID_CLIENT_ID are optional — unset, this
 * verifies HS256 only, exactly as above. Set all three together to also accept
 * App ID's RS256 access tokens (see `session-guard.ts`'s own doc comment).
 */
import { createServer } from 'node:http';
import { identify, validate, MAX_BODY_BYTES } from './identify.ts';
import { createRequestListener } from './http.ts';
import { readAllowedOrigins, type RolesSourceConfig } from './session-guard.ts';

const PORT = Number(process.env['PORT'] ?? 8787);

const ROUTE = '/vision/identify';

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
      '[vision] APPID_REGION, APPID_TENANT_ID and APPID_CLIENT_ID must be set together, ' +
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
      '[vision] POS_API_INTERNAL_ROLES_URL and INTERNAL_API_SECRET must be set together, or not ' +
        'at all. Refusing to start rather than fetch the shared roles document half-configured.'
    );
    process.exit(1);
  }
  return { url, secret };
}

const { secret, origins } = requireConfig();
const appId = readAppIdConfig();

createServer(
  createRequestListener({
    logPrefix: '[vision]',
    route: ROUTE,
    secret,
    appId,
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
