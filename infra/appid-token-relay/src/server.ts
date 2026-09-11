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
 * `APPID_CUSTOMER_CLIENT_ID`/`APPID_CUSTOMER_CLIENT_SECRET` are optional and gate
 * only `/appid/customer/token` (epic #261's self-checkout customers, a second App
 * ID *application* in the same tenant — see `customer-token.ts` for why the client
 * is the whole difference between the two token routes). A deployment without them
 * signs staff in exactly as before; a customer sign-in attempt gets this service's
 * own 502 rather than the whole process refusing to start over a route that is not
 * reachable from the UI yet.
 *
 * `APPID_MANAGEMENT_APIKEY` is optional and gates the admin staff-management
 * routes (`/appid/admin/staff*`) and customer self-registration
 * (`/appid/customer/sign-up`) — every route that creates or changes a Cloud
 * Directory account, which App ID only allows through its Management API. A
 * deployment without it keeps signing people in exactly as before; a call against
 * those routes fails with a 502 the moment it actually reaches the Management API
 * with no real key, rather than this whole service refusing to start over a route
 * most deployments won't use yet.
 */
import { createServer } from 'node:http';
import { relay } from './relay.ts';
import { validate, MAX_BODY_BYTES } from './validate.ts';
import { createRequestListener, ALLOWED_METHODS as TOKEN_METHODS } from './http.ts';
import { createAdminRequestListener, ALLOWED_METHODS as ADMIN_METHODS } from './admin-http.ts';
import { validateCreate, validateAssignRole, MAX_BODY_BYTES as ADMIN_MAX_BODY_BYTES } from './admin-validate.ts';
import {
  validate as validateForgotPassword,
  MAX_BODY_BYTES as FORGOT_PASSWORD_MAX_BODY_BYTES,
} from './forgot-password-validate.ts';
import {
  createUser,
  randomThrowawayPassword,
  listStaffUsers,
  listAssignableStaffRoles,
  assignRole,
  revokeRoles,
  triggerForgotPassword,
  type ManagementConfig,
} from './management-api.ts';
import { readAllowedOrigins } from './cors.ts';
import { createRouter, routeLabel, type Route } from './routes.ts';
import {
  CUSTOMER_TOKEN_ROUTE,
  createCustomerTokenHandler,
  customerClientConfigured,
} from './customer-token.ts';
import {
  CUSTOMER_SIGNUP_ROUTE,
  createCustomerSignupHandler,
  customerSignupConfigured,
} from './customer-signup.ts';
import {
  validate as validateCustomerSignup,
  MAX_BODY_BYTES as CUSTOMER_SIGNUP_MAX_BODY_BYTES,
} from './customer-signup-validate.ts';
import { createRateLimiter } from './rate-limit.ts';

const PORT = Number(process.env['PORT'] ?? 8792);

const TOKEN_ROUTE = '/appid/token';
const ADMIN_ROUTE_PREFIX = '/appid/admin/';
const FORGOT_PASSWORD_ROUTE = '/appid/forgot-password';

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
  customerClientId: string;
  customerClientSecret: string;
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

  // Optional: gates only `/appid/customer/token` — see this file's own header
  // comment. Read here rather than in `customer-token.ts` so the whole of this
  // service's environment is still declared in one place.
  const customerClientId = process.env['APPID_CUSTOMER_CLIENT_ID'] ?? '';
  const customerClientSecret = process.env['APPID_CUSTOMER_CLIENT_SECRET'] ?? '';
  if (!customerClientConfigured({ region, tenantId, customerClientId, customerClientSecret })) {
    console.warn(
      '[appid-relay] APPID_CUSTOMER_CLIENT_ID/APPID_CUSTOMER_CLIENT_SECRET are not both set — ' +
        `staff sign-in works as before, but ${CUSTOMER_TOKEN_ROUTE} answers 502 until the ` +
        'customer application\'s credentials are deployed. Customer grants are never exchanged ' +
        "under the staff client."
    );
  }

  // Optional: gates the admin staff-management routes and customer sign-up —
  // every route that creates or changes a Cloud Directory account. See this
  // file's own header comment.
  const managementApiKey = process.env['APPID_MANAGEMENT_APIKEY'] ?? '';
  if (!customerSignupConfigured({ region, tenantId, apiKey: managementApiKey })) {
    console.warn(
      '[appid-relay] APPID_MANAGEMENT_APIKEY is not set — sign-in works as before, but ' +
        `/appid/admin/staff* and ${CUSTOMER_SIGNUP_ROUTE} will fail once a caller actually reaches the ` +
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
  return {
    region,
    tenantId,
    clientId,
    clientSecret,
    customerClientId,
    customerClientSecret,
    managementApiKey,
    origins,
  };
}

const { region, tenantId, clientId, clientSecret, customerClientId, customerClientSecret, managementApiKey, origins } =
  requireConfig();

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

/**
 * The same two grants as `tokenListener`, over the same tenant, exchanged under
 * the *customer* App ID application instead of the staff one — which is what
 * decides the scopes the returned token carries. Public and unauthenticated for
 * the same reason: a customer signing in does not have a session yet either.
 * `customer-token.ts` holds the credential-selection decision (and the refusal
 * to fall back to staff's client) so it can be tested without a bound port.
 */
const customerTokenListener = createRequestListener({
  logPrefix: '[appid-relay]',
  route: CUSTOMER_TOKEN_ROUTE,
  origins,
  maxBodyBytes: MAX_BODY_BYTES,
  validate,
  handle: createCustomerTokenHandler({ region, tenantId, customerClientId, customerClientSecret }),
  unavailable: 'The customer sign-in service is unavailable.',
});

/**
 * Public and unauthenticated, like both token routes and for the same reason: a
 * customer registering does not have a session yet, and requiring one would make
 * registering impossible. Unlike them it holds no OAuth client — App ID only
 * creates Cloud Directory accounts through the Management API — so it is gated on
 * `APPID_MANAGEMENT_APIKEY` and shares that credential with the admin routes
 * rather than with its own sibling. `customer-signup.ts` holds the role decision
 * (the `customer` scope is a constant here, never a request field) so it can be
 * tested without a bound port.
 *
 * The **one** route on this service with a rate limiter (epic #261 item 8c). It is
 * also the only one that creates state for an unauthenticated caller, which is
 * exactly the asymmetry: a refused sign-in costs App ID one rejected grant, a
 * flood of sign-ups costs a Cloud Directory full of accounts. Neither token route
 * gets one deliberately — see `rate-limit.ts`, and `rate-limit.test.mjs` asserts
 * it through this very table. The counters are per-instance, so the real ceiling
 * is `instances × limit`; `rate-limit.ts` documents why that is still worth having.
 *
 * Epic #261 item 8a — the happy path. A duplicate email or a password App ID's own
 * policy refuses currently surfaces as this boundary's generic 502; giving each its
 * own status is item 8b.
 */
const customerSignupListener = createRequestListener({
  logPrefix: '[appid-relay]',
  route: CUSTOMER_SIGNUP_ROUTE,
  origins,
  maxBodyBytes: CUSTOMER_SIGNUP_MAX_BODY_BYTES,
  validate: validateCustomerSignup,
  handle: createCustomerSignupHandler(managementConfig),
  unavailable: 'The customer sign-up service is unavailable.',
  rateLimit: createRateLimiter(),
  // Deliberately says nothing about the email: this is answered before the body
  // is even read, and #253's anti-enumeration behaviour on the password-reset
  // path is not something this route gets to undo.
  tooManyRequests: 'Too many sign-up attempts. Please try again later.',
});

/**
 * Public, unauthenticated — a person asking to reset their own password does
 * not have a session yet either, same reasoning as `tokenListener`. Never
 * reveals whether the email has an account: `triggerForgotPassword` itself
 * swallows App ID's 404 (no such user) and this always answers `200 {}`
 * either way, so the response can't be used to enumerate real accounts. A
 * genuine failure (management API down, bad key) still surfaces as this
 * boundary's own generic 502 — see `http.ts`'s own contract.
 */
const forgotPasswordListener = createRequestListener({
  logPrefix: '[appid-relay]',
  route: FORGOT_PASSWORD_ROUTE,
  origins,
  maxBodyBytes: FORGOT_PASSWORD_MAX_BODY_BYTES,
  validate: validateForgotPassword,
  handle: async (request) => {
    await triggerForgotPassword(request.email, managementConfig);
    return { status: 200, body: {} };
  },
  unavailable: 'The password-reset service is unavailable.',
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
    // required (`accessMode: "FULL"`), so `createUser`'s own `sign_up`
    // call always leaves a brand-new account `PENDING` and App ID
    // unconditionally 409s a forgot_password request against a
    // not-yet-confirmed account. There is no timing to get right here: it
    // would fail on every single call, not occasionally. `welcomeEnabled:
    // true` on this tenant means `sign_up` already sent its own welcome/
    // confirmation email — the new hire finishes setup through that link,
    // not a second email App ID would refuse to send yet.
    //
    // A throwaway password specifically: this admin route never accepts one
    // from the browser, and the staff member it creates never types it. The
    // caller-supplied variant exists for customer self-registration, where
    // the person signing up chooses their own.
    const created = await createUser(request.email, randomThrowawayPassword(), managementConfig);
    await assignRole(created.id, request.roleId, managementConfig);
    // Spelled out rather than returned whole: `createUser` also reports the SCIM
    // id, which exists for `customer-signup.ts`'s rollback and has no business in
    // a response the browser reads.
    return { id: created.id, email: created.email, displayName: created.displayName };
  },
  reassignRole: async (userId, request) => {
    await assignRole(userId, request.roleId, managementConfig);
    return undefined;
  },
  revoke: (userId) => revokeRoles(userId, managementConfig),
  unavailable: 'The staff-management service is unavailable.',
});

/**
 * The whole of this service's dispatch, declared in one place.
 *
 * Every path this process answers is an entry here; anything else gets
 * `routes.ts`'s own 404. That replaces the previous prefix-match-else-default
 * chain, which sent every unknown path to `tokenListener` and 404'd only
 * because that listener re-checked the path itself — see `routes.ts`'s doc
 * comment for why two checks accidentally agreeing was a bug waiting for the
 * next route.
 */
const ROUTES: readonly Route[] = [
  { match: 'exact', path: TOKEN_ROUTE, methods: TOKEN_METHODS, listener: tokenListener },
  { match: 'exact', path: CUSTOMER_TOKEN_ROUTE, methods: TOKEN_METHODS, listener: customerTokenListener },
  { match: 'exact', path: CUSTOMER_SIGNUP_ROUTE, methods: TOKEN_METHODS, listener: customerSignupListener },
  { match: 'exact', path: FORGOT_PASSWORD_ROUTE, methods: TOKEN_METHODS, listener: forgotPasswordListener },
  // Prefix, not exact: `admin-http.ts` resolves `/staff`, `/roles` and
  // `/staff/{id}/role` itself — including its own 404 for an admin path that is
  // none of those — because only it knows which of them take a body.
  { match: 'prefix', path: ADMIN_ROUTE_PREFIX, methods: ADMIN_METHODS, listener: adminListener },
];

createServer(createRouter({ routes: ROUTES, origins })).listen(PORT, () => {
  for (const route of ROUTES) {
    console.log(`[appid-relay] listening on http://localhost:${PORT}${routeLabel(route)}`);
  }
});
