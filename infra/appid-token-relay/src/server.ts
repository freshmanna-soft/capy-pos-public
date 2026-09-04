/**
 * The process entry point: environment, sockets, and nothing that decides anything.
 *
 * Same split as `infra/clerk-agent-relay/src/server.ts` and the same reason for
 * it: fail before listening, not on the first request, and hold no logic a test
 * cannot exercise without a bound port.
 *
 *   APPID_REGION=us-south APPID_TENANT_ID=… APPID_CLIENT_ID=… APPID_CLIENT_SECRET=… \
 *   ALLOWED_ORIGINS=http://localhost:4200 npm start                # laptop, port 8792
 *
 * Then set `appId.enabled = true` and `appId.relayUrl =
 * 'http://localhost:8792/appid/token'` in the environment file you are serving.
 *
 * `APPID_MANAGEMENT_APIKEY` is optional and gates only the admin staff-management
 * routes (`/appid/admin/staff*`) — a deployment without it keeps signing people in
 * exactly as before; an admin action against those routes fails with a 502 the
 * moment it actually calls the Management API with no real key, rather than this
 * whole service refusing to start over a route most deployments won't use yet.
 */
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { relay } from './relay.ts';
import { validate, MAX_BODY_BYTES } from './validate.ts';
import { createRequestListener } from './http.ts';
import { createAdminRequestListener } from './admin-http.ts';
import { validateCreate, validateAssignRole, MAX_BODY_BYTES as ADMIN_MAX_BODY_BYTES } from './admin-validate.ts';
import {
  createStaffUser,
  listStaffUsers,
  listAssignableStaffRoles,
  assignRole,
  revokeRoles,
  type ManagementConfig,
} from './management-api.ts';
import { readAllowedOrigins } from './cors.ts';

const PORT = Number(process.env['PORT'] ?? 8792);

const TOKEN_ROUTE = '/appid/token';
const ADMIN_ROUTE_PREFIX = '/appid/admin/';

/**
 * Fail before listening, not on the first request.
 *
 * Unlike the sibling proxies' `authorize()` (503 for a secret that changed
 * under a running process), a missing App ID credential here has no per-request
 * fallback to report — every single call needs it, so there's nothing to gain
 * by deferring the failure past startup.
 */
function requireConfig(): {
  region: string;
  tenantId: string;
  clientId: string;
  clientSecret: string;
  managementApiKey: string;
  origins: readonly string[];
} {
  const region = process.env['APPID_REGION'] ?? '';
  const tenantId = process.env['APPID_TENANT_ID'] ?? '';
  const clientId = process.env['APPID_CLIENT_ID'] ?? '';
  const clientSecret = process.env['APPID_CLIENT_SECRET'] ?? '';

  if (region.length === 0 || tenantId.length === 0 || clientId.length === 0 || clientSecret.length === 0) {
    console.error(
      '[appid-relay] APPID_REGION, APPID_TENANT_ID, APPID_CLIENT_ID and APPID_CLIENT_SECRET ' +
        "must all be set — this service's whole purpose is attaching the client secret to " +
        'every App ID token request, so there is no partial-config mode to fall back to. Refusing to start.'
    );
    process.exit(1);
  }

  // Optional: gates only the admin staff-management routes — see this file's
  // own header comment.
  const managementApiKey = process.env['APPID_MANAGEMENT_APIKEY'] ?? '';
  if (managementApiKey.length === 0) {
    console.warn(
      '[appid-relay] APPID_MANAGEMENT_APIKEY is not set — sign-in works as before, but ' +
        '/appid/admin/staff* will fail once an authorized caller actually reaches the ' +
        'Management API.'
    );
  }

  const origins = readAllowedOrigins(process.env['ALLOWED_ORIGINS']);
  if (origins.length === 0) {
    console.error(
      '[appid-relay] ALLOWED_ORIGINS is not set. Give it a comma-separated list of browser ' +
        'origins (e.g. http://localhost:4200). Refusing to start: the alternative — ' +
        'Access-Control-Allow-Origin: * in front of the login endpoint — would let any page ' +
        "on the internet spend attempts against the real tenant."
    );
    process.exit(1);
  }

  console.log(`[appid-relay] origins: ${origins.join(', ')}`);
  return { region, tenantId, clientId, clientSecret, managementApiKey, origins };
}

const { region, tenantId, clientId, clientSecret, managementApiKey, origins } = requireConfig();

const managementConfig: ManagementConfig = { region, tenantId, apiKey: managementApiKey };

const tokenListener = createRequestListener({
  logPrefix: '[appid-relay]',
  route: TOKEN_ROUTE,
  origins,
  maxBodyBytes: MAX_BODY_BYTES,
  validate,
  handle: (request) => relay(request, { region, tenantId, clientId, clientSecret }),
  unavailable: 'The sign-in service is unavailable.',
});

const adminListener = createAdminRequestListener({
  logPrefix: '[appid-relay]',
  // HS256 deliberately disabled in production: every real caller here signed in
  // through AppIdAuthAdapter, which only exists while `appId.enabled` is true —
  // there is no local-credential caller that would ever present an HS256 token
  // to this specific relay. `admin-auth.test.mjs` exercises the HS256 branch
  // directly, without going through this wiring.
  auth: { secret: '', appId: { region, tenantId, audience: clientId } },
  origins,
  maxBodyBytes: ADMIN_MAX_BODY_BYTES,
  validateCreate,
  validateAssignRole,
  listRoles: () => listAssignableStaffRoles(managementConfig),
  list: () => listStaffUsers(managementConfig),
  create: async (request) => {
    // `request.roleId` is already a real App ID role id — the browser got it
    // from `GET /appid/admin/roles` and never invents one itself.
    //
    // No `triggerForgotPassword` call here, despite the plan's original
    // intent — confirmed live that this tenant's `identityConfirmation` is
    // required (`accessMode: "FULL"`), so `createStaffUser`'s own `sign_up`
    // call always leaves a brand-new account `PENDING` and App ID
    // unconditionally 409s a forgot_password request against a
    // not-yet-confirmed account. There is no timing to get right here: it
    // would fail on every single call, not occasionally. `welcomeEnabled:
    // true` on this tenant means `sign_up` already sent its own welcome/
    // confirmation email — the new hire finishes setup through that link,
    // not a second email App ID would refuse to send yet.
    const user = await createStaffUser(request.email, managementConfig);
    await assignRole(user.id, request.roleId, managementConfig);
    return user;
  },
  reassignRole: async (userId, request) => {
    await assignRole(userId, request.roleId, managementConfig);
    return undefined;
  },
  revoke: (userId) => revokeRoles(userId, managementConfig),
  unavailable: 'The staff-management service is unavailable.',
});

createServer((req: IncomingMessage, res: ServerResponse) => {
  const path = req.url?.split('?')[0] ?? '';
  if (path.startsWith(ADMIN_ROUTE_PREFIX)) {
    adminListener(req, res);
  } else {
    tokenListener(req, res);
  }
}).listen(PORT, () => {
  console.log(`[appid-relay] listening on http://localhost:${PORT}${TOKEN_ROUTE}`);
  console.log(`[appid-relay] listening on http://localhost:${PORT}${ADMIN_ROUTE_PREFIX}staff`);
});
