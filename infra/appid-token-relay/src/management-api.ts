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

/**
 * JWKS-cache-style: roles rarely change, so the scope→id table is cached after
 * the first fetch — but a **hit** is the only part of that worth keeping
 * indefinitely. A miss is not an answer about the tenant, it is an answer about
 * this snapshot of it, and `customer-signup.ts` turns "no role grants
 * `customer`" into a 502 telling the operator to go configure that role. Cached
 * permanently, that 502 would outlive the configuring: a single sign-up
 * attempted before epic #261's item 2 landed would keep every later request
 * failing on a correctly configured tenant until the process restarted. So
 * `resolveRoleId` re-reads once before it will answer `null`, and the list
 * expires anyway for the caller that legitimately tolerates a missing scope
 * (`listAssignableStaffRoles`, which omits an unconfigured one by design and so
 * cannot tell a stale list from a correct one).
 */
interface CachedRoles {
  readonly roles: readonly AppIdRoleWire[];
  /** Epoch seconds this snapshot stops being trusted — same shape as `CachedIamToken`. */
  readonly expiresAt: number;
}

let rolesCache: CachedRoles | null = null;

/** Long next to a single request, short next to how often an admin adds a role in the App ID console. */
const ROLES_CACHE_TTL_SECONDS = 300;

/** The cached list while it is still trusted, or `null` — never a fetch. */
function cachedRoles(nowSeconds: () => number): readonly AppIdRoleWire[] | null {
  const cached = rolesCache;
  return cached !== null && cached.expiresAt > nowSeconds() ? cached.roles : null;
}

/** Read `/roles` for real and re-arm the cache. */
async function fetchRoles(config: ManagementConfig, nowSeconds: () => number): Promise<readonly AppIdRoleWire[]> {
  const result = await managementFetch('/roles', config, nowSeconds);
  if (result.status !== 200) {
    throw new ManagementApiError(`Listing App ID roles returned ${result.status}.`);
  }
  const roles = (result.body as { roles?: AppIdRoleWire[] }).roles ?? [];
  rolesCache = { roles, expiresAt: nowSeconds() + ROLES_CACHE_TTL_SECONDS };
  return roles;
}

async function listRoles(config: ManagementConfig, nowSeconds: () => number): Promise<readonly AppIdRoleWire[]> {
  return cachedRoles(nowSeconds) ?? (await fetchRoles(config, nowSeconds));
}

/** Matches by `access[].scopes`, never by the role's display `name` — see `AppIdRoleWire`. */
function roleGranting(roles: readonly AppIdRoleWire[], scope: string): string | null {
  return roles.find((role) => role.access?.some((entry) => entry.scopes?.includes(scope)))?.id ?? null;
}

/**
 * `null` means no App ID role grants this scope — a refusal upstream, not a
 * crash. Matches by `access[].scopes`, never by the role's display `name` —
 * see `AppIdRoleWire`'s own doc comment for why that distinction is load-bearing.
 *
 * A cached list that does not know about this scope is re-read once before that
 * `null` is returned, so the answer is always about the tenant as it is now and
 * not as it was when some earlier request happened to warm the cache — see
 * `CachedRoles`. Exactly one re-read: a freshly fetched list with no match
 * really is `null`.
 */
export async function resolveRoleId(
  scope: string,
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<string | null> {
  const cached = cachedRoles(nowSeconds);
  const hit = cached === null ? null : roleGranting(cached, scope);
  return hit ?? roleGranting(await fetchRoles(config, nowSeconds), scope);
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
 * (Phase 0 only ever confirmed `admin`). Because a missing scope is a legal
 * answer here, this cannot tell a stale list from a correct one and so never
 * forces the re-read `resolveRoleId` does; `CachedRoles`'s TTL is what bounds
 * how long a role added in the console stays missing from this list.
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
 * per user (one for their `sub`, one for their roles) — the Management API has
 * no bulk endpoint for either, and this pilot's staff tenant is small enough
 * that this is not a real cost.
 *
 * `StaffUser.id` is each user's `sub` (from `userinfo`), never the SCIM `id`
 * `cloud_directory/Users` itself returns — see `getUserSub`'s own doc comment
 * for why that distinction is load-bearing.
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
      const sub = await getUserSub(user.id, config, nowSeconds);
      const roles = sub === null ? [] : await getUserRoles(sub, config, nowSeconds);
      return {
        // Falls back to the SCIM id only when `userinfo` itself failed — an
        // id this codebase can no longer use for role operations, but still
        // better than dropping the person from the list entirely.
        id: sub ?? user.id,
        email: user.emails?.find((e) => e.primary)?.value ?? user.emails?.[0]?.value ?? '',
        displayName: user.displayName ?? user.userName ?? user.id,
        roles,
      };
    })
  );
}

/**
 * Resolve a Cloud Directory user's real `sub` (profile id) from their SCIM
 * `id` — confirmed live 2026-09-04: `/users/{id}/roles` 404s
 * (`"Profile not found"`) when given the SCIM id `cloud_directory/Users`
 * itself returns, for *every* user checked, including a real admin who had
 * signed in for real. App ID keeps a separate "profile" identity — the same
 * value the token's own `sub` claim carries — and role operations key off
 * that, not the SCIM record. `null` means the lookup itself failed (network,
 * a user with no profile at all) — treated as "no roles", not a reason to
 * drop the user from the list.
 */
async function getUserSub(
  scimId: string,
  config: ManagementConfig,
  nowSeconds: () => number
): Promise<string | null> {
  const result = await managementFetch(`/cloud_directory/${encodeURIComponent(scimId)}/userinfo`, config, nowSeconds);
  if (result.status !== 200) {
    return null;
  }
  const sub = (result.body as { sub?: unknown }).sub;
  return typeof sub === 'string' && sub.length > 0 ? sub : null;
}

async function getUserRoles(
  sub: string,
  config: ManagementConfig,
  nowSeconds: () => number
): Promise<readonly StaffRole[]> {
  const result = await managementFetch(`/users/${encodeURIComponent(sub)}/roles`, config, nowSeconds);
  if (result.status !== 200) {
    // A user with no roles assigned yet still exists — treat any failure to
    // read their roles as "none", not a reason to drop them from the list.
    return [];
  }
  return (result.body as { roles?: StaffRole[] }).roles ?? [];
}

/**
 * A cryptographically random password for an account whose owner will never
 * type it — what staff creation needs, and what `createUser` used to do
 * unconditionally. Never logged, never returned, never sent anywhere but
 * App ID itself: a new hire finishes setup through the welcome/confirmation
 * email `sign_up` already sends (this tenant has `welcomeEnabled: true`), so
 * nothing here has a "choose your password" secret to protect because nothing
 * here keeps the one it generated.
 *
 * Exported rather than left as `createUser`'s default so the throwaway is
 * asked for out loud at the one call site that wants it, instead of being the
 * silent fallback for every caller — including the customer sign-up route,
 * where silently discarding the password someone just chose would lock them
 * out of the account they were creating.
 */
export function randomThrowawayPassword(): string {
  return randomBytes(24).toString('base64url');
}

/**
 * Create a Cloud Directory user with the caller's password. Staff creation
 * passes `randomThrowawayPassword()` — nobody ever types that account's
 * password — while customer self-registration passes the one the customer
 * chose, which is the whole reason this takes a parameter: a self-checkout
 * customer has to be able to sign in again with what they just typed.
 *
 * Refuses an empty email or password before touching the network. With both
 * values now coming from outside, that is the one guarantee left worth keeping
 * here — it stops an account existing in a state nobody asked for. Real
 * password *policy* (length, strength) and address *format* belong to the
 * route validating the customer's input, not to this transport-level call.
 *
 * The email is checked trimmed but sent as given — exactly how `validate()`
 * treats `username` versus `password`. Whitespace can be a real part of a
 * passphrase and never part of an address, so a spaces-only email is the
 * empty case in disguise; normalizing it, on the other hand, is the input
 * route's job, not this one's.
 *
 * This relay never triggers App ID's `forgot_password` for a freshly created
 * account — confirmed live it 409s unconditionally against one still
 * `PENDING` identity confirmation, which every `sign_up` account starts as
 * on a tenant configured to require it (this one is).
 *
 * Uses `/cloud_directory/sign_up?shouldCreateProfile=true`, not the plainer
 * `/cloud_directory/Users` — confirmed live: the latter's own docs say
 * outright it "does not... create a profile," and role assignment 404s
 * (`"Profile not found"`) without one. The returned `id` is `profileId`
 * (`sign_up`'s name for the same `sub` `getUserSub`/`userinfo` resolves for
 * existing users) — the id every later role operation on this account must use.
 *
 * The SCIM `id` is returned alongside it as `scimId`, not instead of it: the two
 * halves of this account are addressed by different ids, and a caller that has
 * to *undo* this creation needs the other one — see `deleteUserAndProfile`.
 * Absent (`''`) rather than fatal if App ID ever omits it: the account exists by
 * then, so refusing the whole call over a missing id would only hide it.
 */
export async function createUser(
  email: string,
  password: string,
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<{ id: string; scimId: string; email: string; displayName: string }> {
  if (email.trim().length === 0) {
    throw new ManagementApiError('Creating the App ID user requires an email address.');
  }
  if (password.length === 0) {
    throw new ManagementApiError('Creating the App ID user requires a password.');
  }
  const result = await managementFetch('/cloud_directory/sign_up?shouldCreateProfile=true', config, nowSeconds, {
    method: 'POST',
    body: {
      active: true,
      emails: [{ value: email, primary: true }],
      userName: email,
      password,
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
  if (typeof user.profileId !== 'string' || user.profileId.length === 0) {
    throw new ManagementApiError('App ID sign-up did not return a profileId.');
  }
  return {
    id: user.profileId,
    scimId: typeof user.id === 'string' ? user.id : '',
    email: user.emails?.find((e) => e.primary)?.value ?? email,
    displayName: user.displayName ?? user.userName ?? email,
  };
}

/**
 * Delete a Cloud Directory account **and** its profile. The compensating action
 * for a sign-up that created an account it then could not finish configuring
 * (see `customer-signup.ts`'s rollback) — never a routine operation, and the one
 * call in this file that cannot be undone.
 *
 * `remove/{userId}`, not `Users/{userId}`: everything here is created with
 * `shouldCreateProfile=true`, and the latter deletes the record "without
 * removing the associated profile" (its own spec's wording) — which would leave
 * behind exactly the half every role operation keys off.
 *
 * Takes the SCIM id (`createUser`'s `scimId`), not the profile id `assignRole`
 * uses: this endpoint's `userId` is specified as "The ID assigned to a user when
 * they sign in by using Cloud Directory" — the same parameter definition as
 * `cloud_directory/{userId}/userinfo`, which `getUserSub` already calls with the
 * SCIM id against the real tenant. Answers `204`.
 */
export async function deleteUserAndProfile(
  scimId: string,
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<void> {
  const result = await managementFetch(
    `/cloud_directory/remove/${encodeURIComponent(scimId)}`,
    config,
    nowSeconds,
    { method: 'DELETE' }
  );
  if (result.status !== 204 && result.status !== 200) {
    // Never swallowed: the caller's own error message has to be able to name the
    // account this failed to clean up.
    throw new ManagementApiError(`Deleting the App ID user returned ${result.status}.`);
  }
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

/**
 * Triggers App ID's own hosted reset-password email for a self-service
 * "Forgot password" request — the legitimate use for this call. (An earlier
 * version of this file called it right after user creation, which
 * always 409s: a freshly `sign_up`'d account is `PENDING` identity
 * confirmation, and App ID refuses a password reset against one. Removed
 * there for that reason — see #249 — reintroduced here for an
 * already-confirmed account asking for itself, where the same call actually
 * succeeds.) Always resolves, even for an email with no account: App ID's
 * own endpoint does not distinguish the two in its response, and neither
 * does this relay's public route — see `forgot-password-validate.ts`'s
 * caller for why that matters (account enumeration).
 */
export async function triggerForgotPassword(
  email: string,
  config: ManagementConfig,
  nowSeconds: () => number = defaultNow
): Promise<void> {
  const result = await managementFetch('/cloud_directory/forgot_password', config, nowSeconds, {
    method: 'POST',
    body: { user: email },
  });
  if (result.status !== 200 && result.status !== 404) {
    // 404 is App ID answering "no such user" — not this relay's failure, and
    // not something the caller should learn either (see the doc above).
    throw new ManagementApiError(`Triggering the reset-password email returned ${result.status}.`);
  }
}

interface ScimUser {
  readonly id: string;
  /** Only present on `sign_up`'s response — the profile id, i.e. `sub`. */
  readonly profileId?: string;
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
