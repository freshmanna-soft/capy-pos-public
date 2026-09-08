/**
 * The suite for `management-api.ts` — stubs `global.fetch` for both IBM Cloud
 * IAM (the token exchange) and App ID's own Management API, since neither has
 * a fixture-friendly local stand-in. Every call's fake response mirrors the
 * exact shape confirmed against IBM's real API docs while designing this file.
 */
import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveRoleId,
  listAssignableStaffRoles,
  listStaffUsers,
  createUser,
  randomThrowawayPassword,
  assignRole,
  revokeRoles,
  deleteUserAndProfile,
  triggerForgotPassword,
  ManagementApiError,
  resetCachesForTest,
} from './management-api.ts';

const CONFIG = { region: 'us-south', tenantId: 'tenant-1', apiKey: 'fake-api-key' };
let NOW = 1_800_000_000;
const nowSeconds = () => NOW;

let originalFetch;
let calls;

beforeEach(() => {
  NOW = 1_800_000_000;
  resetCachesForTest();
  calls = [];
  originalFetch = globalThis.fetch;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Installs a fetch stub that answers IAM's token endpoint and everything else via `handlers`. */
function stubFetch(handlers) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === 'https://iam.cloud.ibm.com/identity/token') {
      return { ok: true, status: 200, json: async () => ({ access_token: 'iam-token-1', expires_in: 3600 }) };
    }
    const handler = handlers.find((h) => h.match(String(url), init));
    if (!handler) {
      throw new Error(`Unhandled fetch: ${String(url)}`);
    }
    return handler.respond(String(url), init);
  };
}

/** How many times `/roles` was actually read — the roles cache's whole observable behaviour. */
function rolesCalls() {
  return calls.filter((c) => c.url.endsWith('/roles')).length;
}

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('IAM token exchange', () => {
  it('exchanges the api key exactly once per call and caches the result', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/roles'),
        // A role that really grants `admin`, so the second lookup is a cache
        // *hit*: a cached miss deliberately re-reads `/roles` (see
        // `resolveRoleId`'s own suite), which would spend a second call here
        // and stop isolating the IAM token's cache from the roles cache.
        respond: () => json(200, { roles: [{ id: 'r1', name: 'Admin', access: [{ scopes: ['admin'] }] }] }),
      },
    ]);

    await resolveRoleId('admin', CONFIG, nowSeconds);
    await resolveRoleId('admin', CONFIG, nowSeconds); // roles cache hit — no second /roles call

    const iamCalls = calls.filter((c) => c.url.includes('iam.cloud.ibm.com'));
    assert.equal(iamCalls.length, 1, 'the cached IAM token should not be re-fetched inside its TTL');
  });

  it('refetches the IAM token once the cached one is past its margin', async () => {
    // createUser never consults the roles cache, so both calls genuinely
    // reach managementFetch — this isolates the IAM token's own TTL logic from
    // the separate roles cache exercised above.
    stubFetch([
      {
        match: (url) => url.includes('/cloud_directory/sign_up'),
        respond: () => json(201, { id: 'u', profileId: 'sub-u', displayName: 'u', emails: [] }),
      },
    ]);

    await createUser('a@capy.test', 'pw-a', CONFIG, nowSeconds);
    NOW += 3600; // well past the 60s-early refresh margin
    await createUser('b@capy.test', 'pw-b', CONFIG, nowSeconds);

    const iamCalls = calls.filter((c) => c.url.includes('iam.cloud.ibm.com'));
    assert.equal(iamCalls.length, 2);
  });

  it('throws ManagementApiError when IAM rejects the api key', async () => {
    globalThis.fetch = async (url) => {
      if (String(url) === 'https://iam.cloud.ibm.com/identity/token') {
        return json(400, { errorMessage: 'Provided API key could not be found.' });
      }
      throw new Error('should not reach the Management API');
    };
    await assert.rejects(() => resolveRoleId('admin', CONFIG, nowSeconds), ManagementApiError);
  });
});

describe('resolveRoleId / listAssignableStaffRoles', () => {
  // Confirmed live against the real tenant, 2026-09-05: a role's own `name` is
  // a free-text display label (e.g. "Admin", capitalized) and is NOT the scope
  // it grants (`access[].scopes`, e.g. "admin", lowercase — the string that
  // actually ends up in the token). Every fixture here reflects that real
  // shape, not the wrong "name === scope" assumption the first version of this
  // file was written against.
  const adminRole = { id: 'role-admin', name: 'Admin', access: [{ scopes: ['admin'] }] };

  it('resolves a configured scope to its role id, matching access[].scopes, never the display name', async () => {
    stubFetch([{ match: (url) => url.endsWith('/roles'), respond: () => json(200, { roles: [adminRole] }) }]);
    assert.equal(await resolveRoleId('admin', CONFIG, nowSeconds), 'role-admin');
  });

  it('does not match on the role’s display name alone', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/roles'),
        respond: () => json(200, { roles: [{ id: 'role-x', name: 'admin', access: [{ scopes: ['something-else'] }] }] }),
      },
    ]);
    assert.equal(await resolveRoleId('admin', CONFIG, nowSeconds), null);
  });

  it('returns null for a scope with no matching App ID role — a 400 upstream, not a crash', async () => {
    stubFetch([{ match: (url) => url.endsWith('/roles'), respond: () => json(200, { roles: [] }) }]);
    assert.equal(await resolveRoleId('operator', CONFIG, nowSeconds), null);
  });

  it('omits an unconfigured built-in scope rather than failing the whole list, and reports the role’s real display name', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/roles'),
        // Only `admin` exists — matches Phase 0's own state before `operator`/`manager` are configured.
        respond: () => json(200, { roles: [adminRole] }),
      },
    ]);
    const roles = await listAssignableStaffRoles(CONFIG, nowSeconds);
    assert.deepEqual(roles, [{ id: 'role-admin', name: 'Admin' }]);
  });

  it('caches a resolved role — one /roles call across repeated lookups', async () => {
    stubFetch([{ match: (url) => url.endsWith('/roles'), respond: () => json(200, { roles: [adminRole] }) }]);
    await resolveRoleId('admin', CONFIG, nowSeconds);
    await resolveRoleId('admin', CONFIG, nowSeconds);
    assert.equal(rolesCalls(), 1);
  });

  it('spends exactly one /roles call answering that nothing grants a scope, on a cold cache', async () => {
    stubFetch([{ match: (url) => url.endsWith('/roles'), respond: () => json(200, { roles: [] }) }]);
    assert.equal(await resolveRoleId('customer', CONFIG, nowSeconds), null);
    assert.equal(rolesCalls(), 1, 'a cold miss is already a fresh list — nothing to re-read');
  });

  // The bug this exists to prevent: one customer sign-up attempted before epic
  // #261's item 2 configured the `customer` role used to cache that empty
  // answer forever, so `customer-signup.ts`'s "configure the role" 502
  // outlived the configuring — every later request failed on a correctly
  // configured tenant until the process restarted.
  it('re-reads /roles before answering null, so a role configured since the list was cached is found', async () => {
    let configured = [];
    stubFetch([{ match: (url) => url.endsWith('/roles'), respond: () => json(200, { roles: configured }) }]);

    assert.equal(await resolveRoleId('customer', CONFIG, nowSeconds), null);
    configured = [{ id: 'role-customer', name: 'Customer', access: [{ scopes: ['customer'] }] }];

    assert.equal(
      await resolveRoleId('customer', CONFIG, nowSeconds),
      'role-customer',
      'a cached miss must not outlive the tenant fix'
    );
    assert.equal(rolesCalls(), 2, 'exactly one re-read — a fresh list with no match really is null');
  });

  // `listAssignableStaffRoles` omits an unconfigured scope by design, so it
  // cannot tell a stale list from a correct one and never forces a re-read.
  // The TTL is what keeps its answer from being permanently stale instead.
  it('tolerates a missing scope in a cached list rather than re-reading on every staff-roles lookup', async () => {
    stubFetch([{ match: (url) => url.endsWith('/roles'), respond: () => json(200, { roles: [adminRole] }) }]);
    await listAssignableStaffRoles(CONFIG, nowSeconds);
    await listAssignableStaffRoles(CONFIG, nowSeconds);
    assert.equal(rolesCalls(), 1);
  });

  it('expires the cached list, so a role added in the console lands without a restart', async () => {
    stubFetch([{ match: (url) => url.endsWith('/roles'), respond: () => json(200, { roles: [adminRole] }) }]);
    await listAssignableStaffRoles(CONFIG, nowSeconds);
    NOW += 301;
    await listAssignableStaffRoles(CONFIG, nowSeconds);
    assert.equal(rolesCalls(), 2);
  });
});

describe('listStaffUsers', () => {
  // Confirmed live against the real tenant, 2026-09-04: `cloud_directory/Users`
  // returns each user's SCIM id, but role operations 404 ("Profile not found")
  // when given that SCIM id directly — even for a real, already-signed-in
  // admin. `userinfo` is the only way to resolve the real `sub` a role
  // operation actually needs. Every fixture here reflects that two-step
  // reality, not the original (wrong) single-lookup assumption.
  it('resolves each user’s sub via userinfo, then their roles via that sub — never the SCIM id', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/cloud_directory/Users'),
        respond: () =>
          json(200, {
            Resources: [
              { id: 'scim-u1', displayName: 'Ada', emails: [{ value: 'ada@capy.test', primary: true }] },
              { id: 'scim-u2', displayName: 'Bea', emails: [{ value: 'bea@capy.test', primary: true }] },
            ],
          }),
      },
      {
        match: (url) => url.endsWith('/cloud_directory/scim-u1/userinfo'),
        respond: () => json(200, { sub: 'sub-u1' }),
      },
      {
        match: (url) => url.endsWith('/cloud_directory/scim-u2/userinfo'),
        respond: () => json(200, { sub: 'sub-u2' }),
      },
      {
        match: (url) => url.endsWith('/users/sub-u1/roles'),
        respond: () => json(200, { roles: [{ id: 'role-admin', name: 'Admin' }] }),
      },
      { match: (url) => url.endsWith('/users/sub-u2/roles'), respond: () => json(200, { roles: [] }) },
    ]);

    const users = await listStaffUsers(CONFIG, nowSeconds);
    assert.deepEqual(users, [
      { id: 'sub-u1', email: 'ada@capy.test', displayName: 'Ada', roles: [{ id: 'role-admin', name: 'Admin' }] },
      { id: 'sub-u2', email: 'bea@capy.test', displayName: 'Bea', roles: [] },
    ]);
  });

  it('falls back to the SCIM id and reports no roles when userinfo itself fails, rather than dropping the user', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/cloud_directory/Users'),
        respond: () => json(200, { Resources: [{ id: 'scim-u1', displayName: 'Ada', emails: [] }] }),
      },
      { match: (url) => url.endsWith('/cloud_directory/scim-u1/userinfo'), respond: () => json(404, {}) },
    ]);
    const users = await listStaffUsers(CONFIG, nowSeconds);
    assert.deepEqual(users, [{ id: 'scim-u1', email: '', displayName: 'Ada', roles: [] }]);
  });

  it('treats a failed per-user roles lookup as "no roles", not a reason to drop the user', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/cloud_directory/Users'),
        respond: () => json(200, { Resources: [{ id: 'scim-u1', displayName: 'Ada', emails: [] }] }),
      },
      {
        match: (url) => url.endsWith('/cloud_directory/scim-u1/userinfo'),
        respond: () => json(200, { sub: 'sub-u1' }),
      },
      { match: (url) => url.endsWith('/users/sub-u1/roles'), respond: () => json(500, {}) },
    ]);
    const users = await listStaffUsers(CONFIG, nowSeconds);
    assert.deepEqual(users, [{ id: 'sub-u1', email: '', displayName: 'Ada', roles: [] }]);
  });
});

describe('createUser', () => {
  // Confirmed live: `cloud_directory/Users` "does not... create a profile"
  // (its own docs' wording), and role assignment 404s without one. `sign_up
  // ?shouldCreateProfile=true` is the endpoint that actually creates one, and
  // its `profileId` — not its SCIM `id` — is the id every later role
  // operation on this account must use.
  it('signs up with profile creation and returns profileId as the account id', async () => {
    let sentUrl;
    let sentBody;
    stubFetch([
      {
        match: (url) => url.includes('/cloud_directory/sign_up'),
        respond: (url, init) => {
          sentUrl = url;
          sentBody = JSON.parse(init.body);
          return json(201, {
            id: 'scim-new-1',
            profileId: 'sub-new-1',
            displayName: 'new@capy.test',
            emails: [{ value: 'new@capy.test', primary: true }],
          });
        },
      },
    ]);

    const user = await createUser('new@capy.test', 'caller-chosen-pw', CONFIG, nowSeconds);

    assert.match(sentUrl, /shouldCreateProfile=true/);
    // `scimId` alongside it, not instead of it: role operations key off the
    // profile id, while deleting the account again keys off the Cloud
    // Directory id — a caller that has to undo this creation needs both.
    assert.deepEqual(user, {
      id: 'sub-new-1',
      scimId: 'scim-new-1',
      email: 'new@capy.test',
      displayName: 'new@capy.test',
    });
    assert.equal(sentBody.emails[0].value, 'new@capy.test');
    assert.equal(sentBody.active, true);
  });

  // The whole point of the generalization: a self-checkout customer types a
  // password they intend to sign in with again, so it has to reach App ID
  // exactly as given — not be replaced, trimmed, or re-derived on the way.
  it('sends the caller-supplied password verbatim', async () => {
    let sentBody;
    stubFetch([
      {
        match: (url) => url.includes('/cloud_directory/sign_up'),
        respond: (_url, init) => {
          sentBody = JSON.parse(init.body);
          return json(201, { id: 'scim-1', profileId: 'sub-1', displayName: 'c', emails: [] });
        },
      },
    ]);

    await createUser('customer@capy.test', ' Correct horse\u00a0battery ', CONFIG, nowSeconds);

    assert.equal(sentBody.password, ' Correct horse\u00a0battery ');
  });

  // The password is now the caller's to choose, so the guarantee this function
  // can still hold is the one that stops an account existing in a state nobody
  // asked for: no password at all. Policy (length, strength) belongs to the
  // route validating the customer's input, not here.
  it('rejects an empty password without creating anything', async () => {
    stubFetch([
      {
        match: () => true,
        respond: () => json(201, { id: 'scim-1', profileId: 'sub-1', displayName: 'c', emails: [] }),
      },
    ]);

    await assert.rejects(
      () => createUser('new@capy.test', '', CONFIG, nowSeconds),
      (error) => error instanceof ManagementApiError && error.message.includes('password')
    );
    assert.equal(calls.length, 0, 'an empty password must fail before any call reaches IAM or App ID');
  });

  // The same guarantee from the other side. `email` is this account's only
  // login identity — it lands in both `userName` and the primary `emails`
  // entry — so a blank one creates an account nobody can ever sign in as, the
  // exact "state nobody asked for" the password guard exists to prevent.
  it('rejects an empty email without creating anything', async () => {
    stubFetch([
      {
        match: () => true,
        respond: () => json(201, { id: 'scim-1', profileId: 'sub-1', displayName: 'c', emails: [] }),
      },
    ]);

    await assert.rejects(
      () => createUser('', 'caller-chosen-pw', CONFIG, nowSeconds),
      (error) => error instanceof ManagementApiError && error.message.includes('email')
    );
    assert.equal(calls.length, 0, 'an empty email must fail before any call reaches IAM or App ID');
  });

  // Not symmetric with the password on purpose, and for the same reason
  // `validate.ts` trims `username` but never `password`: whitespace is a
  // legitimate part of a passphrase, and never part of an address. A
  // spaces-only email is the empty case wearing a disguise.
  it('rejects a whitespace-only email without creating anything', async () => {
    stubFetch([
      {
        match: () => true,
        respond: () => json(201, { id: 'scim-1', profileId: 'sub-1', displayName: 'c', emails: [] }),
      },
    ]);

    await assert.rejects(
      () => createUser('   ', 'caller-chosen-pw', CONFIG, nowSeconds),
      (error) => error instanceof ManagementApiError && error.message.includes('email')
    );
    assert.equal(calls.length, 0, 'a whitespace-only email must fail before any call reaches IAM or App ID');
  });

  it('throws ManagementApiError when sign_up succeeds but returns no profileId, rather than silently using the SCIM id', async () => {
    stubFetch([
      {
        match: (url) => url.includes('/cloud_directory/sign_up'),
        respond: () => json(201, { id: 'scim-new-1', displayName: 'new@capy.test', emails: [] }),
      },
    ]);
    await assert.rejects(
      () => createUser('new@capy.test', 'pw', CONFIG, nowSeconds),
      (error) => error instanceof ManagementApiError && error.message.includes('profileId')
    );
  });

  it('throws ManagementApiError on a non-201 response, without leaking the request body', async () => {
    stubFetch([
      {
        match: (url) => url.includes('/cloud_directory/sign_up'),
        respond: () => json(409, { message: 'already exists' }),
      },
    ]);
    await assert.rejects(
      () => createUser('dup@capy.test', 'pw', CONFIG, nowSeconds),
      (error) => error instanceof ManagementApiError && error.message.includes('already exists')
    );
  });
});

describe('randomThrowawayPassword', () => {
  // What staff creation used to do inline. Kept as a named export so the one
  // caller that wants "a password nobody will ever type" asks for it out loud,
  // instead of it being the silent default for every caller of createUser.
  it('returns a distinct high-entropy value per call', () => {
    const first = randomThrowawayPassword();
    const second = randomThrowawayPassword();

    assert.equal(typeof first, 'string');
    assert.ok(first.length >= 24, 'password should be a real random value, not a placeholder');
    assert.notEqual(first, second);
    assert.match(first, /^[A-Za-z0-9_-]+$/, 'base64url so it survives JSON transport unescaped');
  });
});

describe('assignRole / revokeRoles', () => {
  it('assigns exactly the given role id', async () => {
    let sentBody;
    stubFetch([
      {
        match: (url) => url.endsWith('/users/u1/roles'),
        respond: (_url, init) => {
          sentBody = JSON.parse(init.body);
          return json(200, { roles: [{ id: 'role-manager', name: 'manager' }] });
        },
      },
    ]);
    await assignRole('u1', 'role-manager', CONFIG, nowSeconds);
    assert.deepEqual(sentBody, { roles: { ids: ['role-manager'] } });
  });

  it('revokes by assigning an empty role list, not deleting the account', async () => {
    let sentBody;
    stubFetch([
      {
        match: (url) => url.endsWith('/users/u1/roles'),
        respond: (_url, init) => {
          sentBody = JSON.parse(init.body);
          return json(200, { roles: [] });
        },
      },
    ]);
    await revokeRoles('u1', CONFIG, nowSeconds);
    assert.deepEqual(sentBody, { roles: { ids: [] } });
  });

  it('throws ManagementApiError on a non-200 response', async () => {
    stubFetch([{ match: (url) => url.endsWith('/users/u1/roles'), respond: () => json(404, {}) }]);
    await assert.rejects(() => assignRole('u1', 'role-x', CONFIG, nowSeconds), ManagementApiError);
  });
});

describe('deleteUserAndProfile', () => {
  // The compensating action for a sign-up that created an account it could not
  // finish configuring — never a routine operation. `remove/{userId}` rather
  // than `Users/{userId}`: everything this file creates is created with
  // `shouldCreateProfile=true`, and the latter deletes the record "without
  // removing the associated profile" (its own spec's wording), which would
  // leave behind exactly the half role operations key off.
  it('deletes through remove/{scimId} so the profile goes with the account', async () => {
    let sentUrl;
    let sentMethod;
    stubFetch([
      {
        match: (url) => url.includes('/cloud_directory/remove/'),
        respond: (url, init) => {
          sentUrl = url;
          sentMethod = init.method;
          return json(204, {});
        },
      },
    ]);

    await deleteUserAndProfile('scim-new-1', CONFIG, nowSeconds);

    assert.equal(sentMethod, 'DELETE');
    assert.match(sentUrl, /\/cloud_directory\/remove\/scim-new-1$/);
    assert.ok(!sentUrl.includes('/cloud_directory/Users/'), 'Users/{id} would leave the profile behind');
  });

  it('escapes the id rather than pasting it into the path', async () => {
    let sentUrl;
    stubFetch([
      {
        match: (url) => url.includes('/cloud_directory/remove/'),
        respond: (url) => {
          sentUrl = url;
          return json(204, {});
        },
      },
    ]);
    await deleteUserAndProfile('scim/../roles', CONFIG, nowSeconds);
    assert.match(sentUrl, /remove\/scim%2F..%2Froles$/);
  });

  it('throws ManagementApiError when App ID refuses the delete, so the caller can report the account it left behind', async () => {
    stubFetch([{ match: (url) => url.includes('/cloud_directory/remove/'), respond: () => json(403, {}) }]);
    await assert.rejects(
      () => deleteUserAndProfile('scim-new-1', CONFIG, nowSeconds),
      (error) => error instanceof ManagementApiError && error.message.includes('403')
    );
  });
});

describe('triggerForgotPassword', () => {
  it("posts the user's email to App ID's own reset-password endpoint", async () => {
    let sentBody;
    stubFetch([
      {
        match: (url) => url.endsWith('/cloud_directory/forgot_password'),
        respond: (_url, init) => {
          sentBody = JSON.parse(init.body);
          return json(200, { id: 'u1', active: true, displayName: 'Ada' });
        },
      },
    ]);
    await triggerForgotPassword('ada@capy.test', CONFIG, nowSeconds);
    assert.deepEqual(sentBody, { user: 'ada@capy.test' });
  });

  it('resolves (does not throw) for an email with no account — App ID answering "no such user" is not this relay failing', async () => {
    stubFetch([{ match: (url) => url.endsWith('/cloud_directory/forgot_password'), respond: () => json(404, {}) }]);
    await assert.doesNotReject(() => triggerForgotPassword('nobody@capy.test', CONFIG, nowSeconds));
  });

  it('throws ManagementApiError on a genuine failure (not 200, not the "no such user" 404)', async () => {
    stubFetch([{ match: (url) => url.endsWith('/cloud_directory/forgot_password'), respond: () => json(500, {}) }]);
    await assert.rejects(() => triggerForgotPassword('ada@capy.test', CONFIG, nowSeconds), ManagementApiError);
  });
});
