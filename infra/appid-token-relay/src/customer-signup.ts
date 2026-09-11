/**
 * `POST /appid/customer/sign-up` — self-registration for a self-checkout
 * customer: an unauthenticated caller supplies an email and the password they
 * chose, and this route creates the Cloud Directory account and grants it the
 * `customer` role, and nothing else.
 *
 * ## Why the Management API and not the customer client
 *
 * Its sibling `/appid/customer/token` (see `customer-token.ts`) is gated on the
 * *customer application's* client pair, because a token grant is exchanged under
 * an OAuth client. Creating a user is not a grant: App ID only creates Cloud
 * Directory accounts through its Management API, which authenticates an IBM Cloud
 * *identity* (`APPID_MANAGEMENT_APIKEY`) rather than an OAuth client. So this
 * route shares its credential with the admin staff routes and not with its own
 * sibling — which is also the reason it can never be done from the browser: that
 * would mean shipping an IBM Cloud IAM key to every visitor (see
 * `management-api.ts`'s own header).
 *
 * ## Why the scope is hard-coded and not a field
 *
 * The role is resolved here from the fixed `customer` scope, never read off the
 * request. `admin-validate.ts` can accept a `roleId` because its caller already
 * proved they are an admin; this route's caller has proved nothing at all, so a
 * caller-chosen role would be a self-service path to a staff-scoped account.
 * `customer-signup-validate.ts` therefore never parses one, and this module never
 * takes one.
 *
 * ## Why no half-registered account is left behind, either way
 *
 * A customer whose account exists but carries no role can sign in and gets a
 * token with no scope `pos-api` maps to anything — a half-registered account
 * that looks fine until the first request fails, and one its owner cannot even
 * retry past, since a second sign-up with the same address collides with the
 * account they don't know exists. Two different failures produce it, so it takes
 * two guards:
 *
 * - **The role is not configured at all** (no App ID role grants `customer` yet
 *   — epic #261's item 2). Resolved *first*, so that deployment problem is
 *   discovered before anything is created and surfaces as this service's own 502
 *   with nothing left behind. (`resolveRoleId` re-reads `/roles` before it will
 *   answer "no such role", so this 502 stops the moment the role lands rather
 *   than outliving it in a cache — see `CachedRoles` in `management-api.ts`.)
 * - **The assignment itself fails** on a tenant where the role does exist —
 *   ordering cannot help here, because the role can only be granted to a user
 *   that already exists. So the creation is rolled back: the account is deleted
 *   again, profile included, and the original failure is still what propagates.
 *   A rollback that fails in turn is reported naming the account it left behind,
 *   never swallowed.
 *
 * Both are asserted in the suite, not just documented.
 *
 * ## Why an unconfigured deployment throws
 *
 * `APPID_MANAGEMENT_APIKEY` is optional at startup, exactly like the customer
 * client pair — a deployment that has not run epic #261's item 25 must keep
 * signing staff in rather than refusing to boot over a route it does not serve
 * yet. Refusing here rather than at registration means an unconfigured deployment
 * answers a 502 (this service is not ready) instead of a 404 (this route does not
 * exist), which would be a lie the moment the secret lands. Same reasoning, and
 * the same shape, as `customerClientConfigured`.
 *
 * ## What a rejected sign-up answers (item 8b)
 *
 * Item 8a shipped the happy path and let every failure fall through to `http.ts`'s
 * generic 502. Two of them are not outages at all but answers the caller asked
 * for, and they are the two this module now classifies — from the status and
 * wording App ID itself returned (`ManagementApiError.status`/`.detail`), never
 * from pattern-matching a sentence:
 *
 * - **The address already has an account** → `409` with `DUPLICATE_EMAIL_MESSAGE`.
 * - **The tenant's password policy refused the password** → `400` with a message
 *   built from App ID's own explanation, so the caller learns what to change.
 *
 * Anything else still throws and still becomes a 502: an unrecognised failure is
 * an outage until proven otherwise, not a 4xx guess.
 *
 * ## Why 409 for a duplicate, and not #253's one-identical-outcome
 *
 * This is a deliberate, argued decision, and `customer-signup.test.mjs` pins it so
 * changing it again has to be deliberate too.
 *
 * A distinguishable duplicate answer *is* an account-enumeration oracle on a
 * public, unauthenticated route, and #253's `forgot-password` path deliberately
 * refuses to be one — it answers identically whether or not the address exists.
 * The difference is what the route is *for*. `forgot-password` has no legitimate
 * reason to tell a caller anything about an address: the person who owns it learns
 * the outcome by email, so a uniform answer costs a real user nothing. Sign-up
 * cannot borrow that: the caller is mid-form and the only useful thing to say
 * about an address that is already taken is that it is taken. A uniform answer
 * would mean either silently not creating the account (and telling someone their
 * sign-up worked when it did not), or making success itself say nothing — which
 * means dropping the created account's id from the response, i.e. changing the
 * happy path's contract, explicitly out of scope for this item.
 *
 * So the oracle is accepted here rather than pretended away, and bounded instead:
 * item 8c's per-IP limiter (`rate-limit.ts`) caps how fast it can be queried, the
 * 429 it answers with is deliberately body-independent so it leaks nothing itself,
 * and the message below is worded to be useful to the person who owns the address
 * without volunteering anything a probe could not already infer from the status.
 * The information disclosed — "this store has a customer with this email" — is
 * also what any store's sign-up form discloses; a shopper's membership is not the
 * secret a password-reset probe is after.
 *
 * ## What a sign-up still does not give you
 *
 * Neither the `201` nor the `409` implies a usable session, and neither may start
 * to. Item 3 established empirically (2026-09-11) that an account this route just
 * created is `PENDING` and cannot complete a password grant until it is confirmed
 * by email — App ID answers `403 "Pending user verification"`. That is the fact
 * item 17's interstitial is built on, which is why the `201` carries an id and an
 * address and no token, and why the duplicate message says to *try* signing in
 * rather than promising it will work.
 *
 * Rate limiting is item 8c (already landed, see `rate-limit.ts`) and no UI is
 * here: the sign-up form is item 16, the interstitial item 17.
 */
import {
  ManagementApiError,
  assignRole as assignRoleDefault,
  createUser as createUserDefault,
  deleteUserAndProfile as deleteUserAndProfileDefault,
  resolveRoleId as resolveRoleIdDefault,
  type ManagementConfig,
} from './management-api.ts';
import type { CustomerSignupRequest } from './customer-signup-validate.ts';
import type { RelayResponse } from './relay.ts';

/** The customer self-registration path. A sibling of `/appid/customer/token`. */
export const CUSTOMER_SIGNUP_ROUTE = '/appid/customer/sign-up';

/**
 * The one scope this route ever grants. A constant, never a request field —
 * see this file's header.
 */
export const CUSTOMER_SCOPE = 'customer';

/**
 * The answer to a sign-up for an address that already has an account. A fixed
 * string: it never quotes the address back, never says which account, and reads
 * the same for a shopper who forgot they had signed up as for anything else. See
 * this file's header for why this route answers a distinguishable 409 at all.
 */
export const DUPLICATE_EMAIL_MESSAGE =
  'That email address cannot be used to sign up. If the account is yours, try signing in instead, ' +
  'or reset your password if you have forgotten it.';

/** `409`: the request was well-formed and the conflict is with existing state. */
export const DUPLICATE_EMAIL_STATUS = 409;

/**
 * The lead sentence for a password the tenant's policy refused. App ID's own
 * explanation is appended when it gave a usable one — this alone is what the
 * caller gets when it did not, because "invalid password" with no upstream text
 * is still better than a blob.
 */
export const PASSWORD_POLICY_MESSAGE = 'That password does not meet the password policy for this store.';

/** `400`: the caller can fix this by sending a different password. */
export const PASSWORD_POLICY_STATUS = 400;

/** Longest upstream explanation forwarded. Past this it is not a message to a person. */
const MAX_DETAIL_LENGTH = 200;

/**
 * The caller-facing answer for a `createUser` failure that is really the caller's
 * to know about, or `null` when it is not — in which case the failure is an outage
 * as far as this route is concerned and has to keep propagating to `http.ts`'s 502.
 *
 * Exported because it is the whole decision this item makes, and a pure function of
 * what App ID returned is the honest way to test it. `email` is passed only to be
 * kept *out* of the answer: an upstream explanation that quotes the address back is
 * not forwarded.
 */
export function signupRefusal(error: unknown, email: string): RelayResponse | null {
  if (!(error instanceof ManagementApiError)) {
    return null;
  }
  const detail = error.detail;

  if (error.status === DUPLICATE_EMAIL_STATUS || mentionsExistingAccount(detail)) {
    return { status: DUPLICATE_EMAIL_STATUS, body: { error: DUPLICATE_EMAIL_MESSAGE } };
  }

  if (error.status === PASSWORD_POLICY_STATUS && /password/i.test(detail ?? '')) {
    const usable = usableDetail(detail, email);
    return {
      status: PASSWORD_POLICY_STATUS,
      body: { error: usable === null ? PASSWORD_POLICY_MESSAGE : `${PASSWORD_POLICY_MESSAGE} ${usable}` },
    };
  }

  return null;
}

/**
 * Whether App ID said the account already exists, for the tenants that answer a
 * conflict with a 400 rather than a 409. Wording-based and therefore a *second*
 * signal, never the only one — the status is checked first.
 */
function mentionsExistingAccount(detail: string | undefined): boolean {
  return /already (?:exists|registered|taken|in use)|email .*(?:exists|taken)/i.test(detail ?? '');
}

/**
 * App ID's explanation, if it is fit to show a person: one line, short enough to
 * read, not a serialized body, and not quoting the caller's own address back at
 * them. `null` for anything else — the fixed message is used instead, which is the
 * difference between a usable rejection and a forwarded blob.
 */
function usableDetail(detail: string | undefined, email: string): string | null {
  if (detail === undefined) {
    return null;
  }
  const collapsed = detail.replace(/\s+/g, ' ').trim();
  if (collapsed.length === 0 || collapsed.length > MAX_DETAIL_LENGTH) {
    return null;
  }
  if (/[{}<>]/.test(collapsed)) {
    // A JSON or markup fragment, not a sentence someone wrote to be read.
    return null;
  }
  if (email.length > 0 && collapsed.toLowerCase().includes(email.toLowerCase())) {
    return null;
  }
  return collapsed.endsWith('.') ? collapsed : `${collapsed}.`;
}

/**
 * The Management API half of the App ID config. Deliberately does *not* name any
 * client pair: this route exchanges no grant, so a config object carrying one
 * could only invite a caller-visible client id into a path that has no use for it.
 */
export type CustomerSignupConfig = ManagementConfig;

/**
 * The Management API calls this route makes. Real ones in production, stubbed in
 * the suite — the same injection shape `customer-token.ts` uses for `relay()`,
 * so the ordering and the "never assign anything but `customer`" guarantees are
 * provable without a tenant.
 */
export interface CustomerSignupDeps {
  readonly resolveRoleId: (scope: string, config: ManagementConfig) => Promise<string | null>;
  readonly createUser: (
    email: string,
    password: string,
    config: ManagementConfig
  ) => Promise<{ id: string; scimId: string; email: string; displayName: string }>;
  readonly assignRole: (userId: string, roleId: string, config: ManagementConfig) => Promise<void>;
  /** The rollback, never a routine call — see this file's header. Keyed by the Cloud Directory id. */
  readonly deleteUserAndProfile: (scimId: string, config: ManagementConfig) => Promise<void>;
}

const DEFAULT_DEPS: CustomerSignupDeps = {
  resolveRoleId: (scope, config) => resolveRoleIdDefault(scope, config),
  createUser: (email, password, config) => createUserDefault(email, password, config),
  assignRole: (userId, roleId, config) => assignRoleDefault(userId, roleId, config),
  deleteUserAndProfile: (scimId, config) => deleteUserAndProfileDefault(scimId, config),
};

/**
 * Whether this deployment can serve customer sign-up at all. `server.ts` reads
 * this only to warn at startup — the route is registered either way, so an
 * unconfigured deployment answers a 502 rather than a 404.
 */
export function customerSignupConfigured(config: CustomerSignupConfig): boolean {
  return config.apiKey.length > 0;
}

/**
 * The `handle` for `createRequestListener`. Resolves `201` with the created
 * account's profile id — the `sub` every later call about this customer keys off
 * — and throws only for what really is this service's problem (the Management
 * API failing, the key not configured, or no App ID role granting `customer`).
 */
export function createCustomerSignupHandler(
  config: CustomerSignupConfig,
  deps: CustomerSignupDeps = DEFAULT_DEPS
): (request: CustomerSignupRequest) => Promise<RelayResponse> {
  return async (request) => {
    if (!customerSignupConfigured(config)) {
      // Rejected before the call, so nothing is half-created against the real
      // tenant under an empty IAM credential — see this file's header.
      throw new Error(
        `APPID_MANAGEMENT_APIKEY must be set to serve ${CUSTOMER_SIGNUP_ROUTE}. ` +
          'Customer accounts are created through the App ID Management API, which needs a real IBM Cloud identity.'
      );
    }

    // Before creation, deliberately: a created-but-role-less customer is a
    // half-registered account — see this file's header.
    const roleId = await deps.resolveRoleId(CUSTOMER_SCOPE, config);
    if (roleId === null) {
      throw new Error(
        `No App ID role grants the "${CUSTOMER_SCOPE}" scope, so a customer account cannot be given one. ` +
          'Configure the customer role in this tenant before serving sign-up.'
      );
    }

    let user: Awaited<ReturnType<CustomerSignupDeps['createUser']>>;
    try {
      user = await deps.createUser(request.email, request.password, config);
    } catch (error) {
      // Nothing was created, so there is nothing to roll back — the only question
      // is whether this is the caller's answer or this service's outage.
      const refusal = signupRefusal(error, request.email);
      if (refusal === null) {
        throw error;
      }
      return refusal;
    }

    try {
      await deps.assignRole(user.id, roleId, config);
    } catch (error) {
      // The account exists by now and has no role — see this file's header.
      await rollBackCreation(user, deps, config, error);
    }

    return { status: 201, body: { id: user.id, email: user.email } };
  };
}

/**
 * Delete an account whose role assignment failed, then re-throw: never resolves.
 * The customer asked for an account that works, and one without its role is not
 * it — so the failure is still the answer, and the account does not survive it.
 *
 * Deleting is safe *only* because this account was created by this request, moments
 * ago: the duplicate-email case never reaches here (`createUser` itself throws, and
 * that existing account is someone else's).
 *
 * Every outcome throws, and every message says which of the three it was — the
 * account was deleted again, or it was not and here is the id to go clean up.
 * `http.ts` logs it and answers its own generic 502 either way, so this is the
 * only record an operator gets; the original failure stays reachable as `cause`.
 *
 * Ids only, never the email: an operator chasing an account left behind needs its
 * id, not the address of the person who was trying to register.
 */
async function rollBackCreation(
  user: { readonly id: string; readonly scimId: string },
  deps: CustomerSignupDeps,
  config: CustomerSignupConfig,
  cause: unknown
): Promise<never> {
  const failed = `Granting new account ${user.id} the "${CUSTOMER_SCOPE}" role failed (${messageOf(cause)})`;
  const orphaned =
    'That account now exists with no role and must be deleted or granted one by hand.';

  if (user.scimId.length === 0) {
    // Nothing to delete *with*: `remove/{userId}` takes the Cloud Directory id,
    // which is not interchangeable with the profile id. Reported rather than
    // guessed at — a delete against the wrong id is not a rollback.
    throw new Error(
      `${failed}, and App ID returned no Cloud Directory id to undo it with. ${orphaned}`,
      { cause }
    );
  }

  try {
    await deps.deleteUserAndProfile(user.scimId, config);
  } catch (rollbackError) {
    throw new Error(
      `${failed}, and deleting it again failed too (${messageOf(rollbackError)}). ${orphaned}`,
      {
        cause,
      }
    );
  }

  throw new Error(
    `${failed}, so the account was deleted again — nothing was left half-registered.`,
    { cause }
  );
}

/** Whatever a thrown value has to say for itself, without assuming it was an `Error`. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
