/**
 * IBM App ID's Management API — the surface the admin-only staff routes need,
 * and nothing else. Every call here requires a real IBM Cloud IAM bearer token,
 * never the `APPID_CLIENT_SECRET` this service already holds: the Management API
 * authenticates the *caller* (an IBM Cloud identity with rights over this App ID
 * instance), not an OAuth client. That is a genuinely different, more powerful
 * credential — `APPID_MANAGEMENT_APIKEY` — which is why creating/listing/deleting
 * a Cloud Directory user could never be done from the browser: that would mean
 * shipping an IBM Cloud IAM credential to every visitor, a strictly worse version
 * of the client-secret problem `relay.ts` already exists to avoid.
 *
 * Every endpoint below is confirmed against IBM's own Management API docs, not
 * guessed: `cloud_directory/Users` (create/list), `roles` (name → id),
 * `users/{id}/roles` (get/assign), `cloud_directory/forgot_password` (trigger
 * App ID's own hosted reset-password email — the reason this service never needs
 * a "choose your password" UI of its own).
 */
import { randomBytes } from 'node:crypto';

export interface ManagementConfig {
  readonly region: string;
  readonly tenantId: string;
  readonly apiKey: string;
}

export class ManagementApiError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ManagementApiError';
  }
}

/** A role the admin can assign — the ones this codebase actually resolves permissions for. */
export interface StaffRole {
  readonly id: string;
  readonly name: string;
}

export interface StaffUser {
  readonly id: string;
  readonly email: string;
  readonly displayName: string;
  readonly roles: readonly StaffRole[];
}

function managementBase(config: ManagementConfig): string {
  return `https://${config.region}.appid.cloud.ibm.com/management/v4/${config.tenantId}`;
}

// ---------------------------------------------------------------------------
// IAM token exchange
// ---------------------------------------------------------------------------

interface CachedIamToken {
  readonly token: string;
  /** Epoch seconds this token is treated as no-longer-usable — see the refresh margin below. */
  readonly expiresAt: number;
}

let iamTokenCache: CachedIamToken | null = null;

/**
 * Exchange `APPID_MANAGEMENT_APIKEY` for a bearer token, same mechanism
 * `ibmcloud login --apikey` uses. Cached in memory and refreshed 60 seconds
 * before its real expiry — a margin against a token expiring mid-request, not
 * because IAM's own clock is expected to drift.
 */
async function getIamToken(apiKey: string, nowSeconds: () => number): Promise<string> {
  const cached = iamTokenCache;
  if (cached && cached.expiresAt > nowSeconds()) {
    return cached.token;
  }

  let response: Response;
  try {
    response = await fetch('https://iam.cloud.ibm.com/identity/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({
        grant_type: 'urn:ibm:params:oauth:grant-type:apikey',
        apikey: apiKey,
      }),
    });
  } catch (err) {
    throw new ManagementApiError(`IAM token exchange failed: ${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new ManagementApiError(`IAM token exchange returned ${response.status}`);
  }

  const data = (await response.json()) as { access_token?: string; expires_in?: number };
  if (typeof data.access_token !== 'string' || data.access_token.length === 0) {
    throw new ManagementApiError('IAM token exchange returned no access_token.');
  }

  const ttl = typeof data.expires_in === 'number' && data.expires_in > 60 ? data.expires_in : 300;
  iamTokenCache = { token: data.access_token, expiresAt: nowSeconds() + ttl - 60 };
  return iamTokenCache.token;
}

// ---------------------------------------------------------------------------
// Management API calls
// ---------------------------------------------------------------------------

async function managementFetch(
  path: string,
  config: ManagementConfig,
  nowSeconds: () => number,
  init: { method: string; body?: unknown } = { method: 'GET' }
): Promise<{ status: number; body: unknown }> {
  const token = await getIamToken(config.apiKey, nowSeconds);

  let response: Response;
  try {
    response = await fetch(`${managementBase(config)}${path}`, {
      method: init.method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    });
  } catch (err) {
    throw new ManagementApiError(`App ID Management API request failed: ${(err as Error).message}`);
  }

  const body: unknown = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

/**
 * A role as `GET /roles` actually returns it — confirmed live against the
 * real tenant, not the docs alone: the role's own `name` is a free-text
 * display label an admin chose in the App ID console (e.g. `"Admin"`,
 * capitalized) and is **not** the same string as the scope it grants
 * (`access[].scopes`, e.g. `"admin"`, lowercase — the exact string that ends
 * up in the token's `scope` claim and that `AppIdAuthAdapter`/`session-auth.ts`
 * actually check). Matching by `name` here would silently omit every
 * configured role — found live 2026-09-05 provisioning the very first
 * `Manager`-scoped key for this file, not something a fixture would have
 * caught, since the fixture data was written from the same wrong assumption.
 */
interface AppIdRoleWire {
  readonly id: string;
  readonly name: string;
  readonly access?: readonly { readonly scopes?: readonly string[] }[];
}

/** JWKS-cache-style: roles rarely change, so the scope→id table is cached after the first fetch. */
let rolesCache: readonly AppIdRoleWire[] | null = null;

async function listRoles(config: ManagementConfig, nowSeconds: () => number): Promise<readonly AppIdRoleWire[]> {
  if (rolesCache) {
    return rolesCache;
  }
  const result = await managementFetch('/roles', config, nowSeconds);
  if (result.status !== 200) {
    throw new ManagementApiError(`Listing App ID roles returned ${result.status}.`);
  }
  const roles = (result.body as { roles?: AppIdRoleWire[] }).roles ?? [];
  rolesCache = roles;
  return roles;
}

/**
 * `null` means no App ID role grants this scope — a 400 to the caller, not a
 * crash. Matches by `access[].scopes`, never by the role's display `name` —
 * see `AppIdRoleWire`'s own doc comment for why that distinction is load-bearing.
 */
export async function resolveRoleId(
  scope: string,
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<string | null> {
  const roles = await listRoles(config, nowSeconds);
  return roles.find((role) => role.access?.some((entry) => entry.scopes?.includes(scope)))?.id ?? null;
}

/**
 * The three scopes this codebase's own scope→permission mapping resolves
 * (`AppIdAuthAdapter.resolveRoles()`, `session-auth.ts`'s `ROLE_PERMISSIONS`) —
 * the only ones an "add staff" action could ever meaningfully assign. Scopes,
 * not display names — see `AppIdRoleWire`'s own doc comment.
 */
const ASSIGNABLE_SCOPES = ['operator', 'manager', 'admin'] as const;

/**
 * The roles `GET /appid/admin/roles` actually offers: each of the three
 * scopes that has a real App ID role granting it, reported under that role's
 * own real display name and id (e.g. `{id: "e8c7...", name: "Admin"}` — the
 * name an admin actually configured in the App ID console, not the internal
 * scope string used to find it). A scope with no role configured yet is
 * silently omitted, not an error — see Phase 3d's own prerequisite note
 * (Phase 0 only ever confirmed `admin`).
 */
export async function listAssignableStaffRoles(
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<readonly StaffRole[]> {
  const roles = await listRoles(config, nowSeconds);
  const matches = ASSIGNABLE_SCOPES.map((scope) =>
    roles.find((role) => role.access?.some((entry) => entry.scopes?.includes(scope)))
  );
  return matches
    .filter((role): role is AppIdRoleWire => role !== undefined)
    .map((role) => ({ id: role.id, name: role.name }));
}

/**
 * List every Cloud Directory user with the roles they currently hold. N+1 calls
 * (one per user for their roles) — the Management API has no bulk roles
 * endpoint, and this pilot's staff tenant is small enough that this is not a
 * real cost.
 */
export async function listStaffUsers(
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<readonly StaffUser[]> {
  const listResult = await managementFetch('/cloud_directory/Users', config, nowSeconds);
  if (listResult.status !== 200) {
    throw new ManagementApiError(`Listing App ID users returned ${listResult.status}.`);
  }
  const resources = (listResult.body as { Resources?: ScimUser[] }).Resources ?? [];

  return Promise.all(
    resources.map(async (user): Promise<StaffUser> => {
      const roles = await getUserRoles(user.id, config, nowSeconds);
      return {
        id: user.id,
        email: user.emails?.find((e) => e.primary)?.value ?? user.emails?.[0]?.value ?? '',
        displayName: user.displayName ?? user.userName ?? user.id,
        roles,
      };
    })
  );
}

async function getUserRoles(
  userId: string,
  config: ManagementConfig,
  nowSeconds: () => number
): Promise<readonly StaffRole[]> {
  const result = await managementFetch(`/users/${encodeURIComponent(userId)}/roles`, config, nowSeconds);
  if (result.status !== 200) {
    // A user with no roles assigned yet still exists — treat any failure to
    // read their roles as "none", not a reason to drop them from the list.
    return [];
  }
  return (result.body as { roles?: StaffRole[] }).roles ?? [];
}

/**
 * Create a Cloud Directory user with a cryptographically random, throwaway
 * password — never logged, never returned. The caller (`admin-http.ts`)
 * immediately follows this with `triggerForgotPassword` so the new hire sets
 * their own real password via App ID's own hosted email, and this relay never
 * has a "choose your password" secret to protect in the first place.
 */
export async function createStaffUser(
  email: string,
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<{ id: string; email: string; displayName: string }> {
  const result = await managementFetch('/cloud_directory/Users', config, nowSeconds, {
    method: 'POST',
    body: {
      active: true,
      emails: [{ value: email, primary: true }],
      userName: email,
      password: randomBytes(24).toString('base64url'),
    },
  });
  if (result.status !== 201) {
    const description =
      typeof result.body === 'object' && result.body !== null && 'message' in result.body
        ? String((result.body as { message: unknown }).message)
        : `status ${result.status}`;
    throw new ManagementApiError(`Creating the App ID user failed: ${description}`);
  }
  const user = result.body as ScimUser;
  return {
    id: user.id,
    email: user.emails?.find((e) => e.primary)?.value ?? email,
    displayName: user.displayName ?? user.userName ?? email,
  };
}

/** Assigns exactly the given role, replacing whatever the user held before — matches `PUT`'s own "set", not "add", semantics. */
export async function assignRole(
  userId: string,
  roleId: string,
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<void> {
  const result = await managementFetch(`/users/${encodeURIComponent(userId)}/roles`, config, nowSeconds, {
    method: 'PUT',
    body: { roles: { ids: [roleId] } },
  });
  if (result.status !== 200) {
    throw new ManagementApiError(`Assigning the App ID role returned ${result.status}.`);
  }
}

/**
 * Revoke = unassign every role, not delete the account. Reversible — an admin
 * can re-assign later — and matches `DexieOperatorAdminAdapter.revokeMembership`'s
 * own "remove this tenant's membership, not delete the person" semantics.
 */
export async function revokeRoles(
  userId: string,
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<void> {
  const result = await managementFetch(`/users/${encodeURIComponent(userId)}/roles`, config, nowSeconds, {
    method: 'PUT',
    body: { roles: { ids: [] } },
  });
  if (result.status !== 200) {
    throw new ManagementApiError(`Revoking the App ID role returned ${result.status}.`);
  }
}

/** Triggers App ID's own hosted reset-password email. Fire-and-forget from the caller's point of view — see `createStaffUser`'s doc comment. */
export async function triggerForgotPassword(
  email: string,
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<void> {
  const result = await managementFetch('/cloud_directory/forgot_password', config, nowSeconds, {
    method: 'POST',
    body: { user: email },
  });
  if (result.status !== 200) {
    throw new ManagementApiError(`Triggering the reset-password email returned ${result.status}.`);
  }
}

interface ScimUser {
  readonly id: string;
  readonly displayName?: string;
  readonly userName?: string;
  readonly emails?: readonly { readonly value: string; readonly primary?: boolean }[];
}

function defaultNow(): number {
  return Math.floor(Date.now() / 1000);
}

/** Test-only: both in-memory caches are module state, so a suite that exercises rotation must be able to clear them. */
export function resetCachesForTest(): void {
  iamTokenCache = null;
  rolesCache = null;
}
