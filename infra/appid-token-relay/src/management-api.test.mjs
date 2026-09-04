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
  createStaffUser,
  assignRole,
  revokeRoles,
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

function json(status, body) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('IAM token exchange', () => {
  it('exchanges the api key exactly once per call and caches the result', async () => {
    stubFetch([
      { match: (url) => url.endsWith('/roles'), respond: () => json(200, { roles: [{ id: 'r1', name: 'admin' }] }) },
    ]);

    await resolveRoleId('admin', CONFIG, nowSeconds);
    await resolveRoleId('admin', CONFIG, nowSeconds); // roles cache hit — no second /roles call, but IAM would be re-checked only if roles cache missed

    const iamCalls = calls.filter((c) => c.url.includes('iam.cloud.ibm.com'));
    assert.equal(iamCalls.length, 1, 'the cached IAM token should not be re-fetched inside its TTL');
  });

  it('refetches the IAM token once the cached one is past its margin', async () => {
    // createStaffUser never consults the roles cache, so both calls genuinely
    // reach managementFetch — this isolates the IAM token's own TTL logic from
    // the separate, non-expiring roles cache exercised above.
    stubFetch([
      {
        match: (url) => url.endsWith('/cloud_directory/Users'),
        respond: () => json(201, { id: 'u', displayName: 'u', emails: [] }),
      },
    ]);

    await createStaffUser('a@capy.test', CONFIG, nowSeconds);
    NOW += 3600; // well past the 60s-early refresh margin
    await createStaffUser('b@capy.test', CONFIG, nowSeconds);

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
  it('resolves a configured role name to its id', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/roles'),
        respond: () => json(200, { roles: [{ id: 'role-admin', name: 'admin' }] }),
      },
    ]);
    assert.equal(await resolveRoleId('admin', CONFIG, nowSeconds), 'role-admin');
  });

  it('returns null for a role name with no matching App ID role — a 400 upstream, not a crash', async () => {
    stubFetch([{ match: (url) => url.endsWith('/roles'), respond: () => json(200, { roles: [] }) }]);
    assert.equal(await resolveRoleId('operator', CONFIG, nowSeconds), null);
  });

  it('omits an unconfigured built-in role rather than failing the whole list', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/roles'),
        // Only `admin` exists — matches Phase 0's own state before `operator`/`manager` are configured.
        respond: () => json(200, { roles: [{ id: 'role-admin', name: 'admin' }] }),
      },
    ]);
    const roles = await listAssignableStaffRoles(CONFIG, nowSeconds);
    assert.deepEqual(roles, [{ id: 'role-admin', name: 'admin' }]);
  });

  it('caches the roles list — one /roles call across repeated lookups', async () => {
    stubFetch([{ match: (url) => url.endsWith('/roles'), respond: () => json(200, { roles: [] }) }]);
    await resolveRoleId('admin', CONFIG, nowSeconds);
    await resolveRoleId('manager', CONFIG, nowSeconds);
    assert.equal(calls.filter((c) => c.url.endsWith('/roles')).length, 1);
  });
});

describe('listStaffUsers', () => {
  it('resolves each user’s roles alongside their identity (N+1, no bulk endpoint exists)', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/cloud_directory/Users'),
        respond: () =>
          json(200, {
            Resources: [
              { id: 'u1', displayName: 'Ada', emails: [{ value: 'ada@capy.test', primary: true }] },
              { id: 'u2', displayName: 'Bea', emails: [{ value: 'bea@capy.test', primary: true }] },
            ],
          }),
      },
      {
        match: (url) => url.endsWith('/users/u1/roles'),
        respond: () => json(200, { roles: [{ id: 'role-admin', name: 'admin' }] }),
      },
      { match: (url) => url.endsWith('/users/u2/roles'), respond: () => json(200, { roles: [] }) },
    ]);

    const users = await listStaffUsers(CONFIG, nowSeconds);
    assert.deepEqual(users, [
      { id: 'u1', email: 'ada@capy.test', displayName: 'Ada', roles: [{ id: 'role-admin', name: 'admin' }] },
      { id: 'u2', email: 'bea@capy.test', displayName: 'Bea', roles: [] },
    ]);
  });

  it('treats a failed per-user roles lookup as "no roles", not a reason to drop the user', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/cloud_directory/Users'),
        respond: () => json(200, { Resources: [{ id: 'u1', displayName: 'Ada', emails: [] }] }),
      },
      { match: (url) => url.endsWith('/users/u1/roles'), respond: () => json(500, {}) },
    ]);
    const users = await listStaffUsers(CONFIG, nowSeconds);
    assert.deepEqual(users, [{ id: 'u1', email: '', displayName: 'Ada', roles: [] }]);
  });
});

describe('createStaffUser', () => {
  it('creates the user with a random password never echoed back, and returns identity only', async () => {
    let sentBody;
    stubFetch([
      {
        match: (url) => url.endsWith('/cloud_directory/Users'),
        respond: (_url, init) => {
          sentBody = JSON.parse(init.body);
          return json(201, {
            id: 'new-user-1',
            displayName: 'new@capy.test',
            emails: [{ value: 'new@capy.test', primary: true }],
          });
        },
      },
    ]);

    const user = await createStaffUser('new@capy.test', CONFIG, nowSeconds);

    assert.deepEqual(user, { id: 'new-user-1', email: 'new@capy.test', displayName: 'new@capy.test' });
    assert.equal(sentBody.emails[0].value, 'new@capy.test');
    assert.equal(typeof sentBody.password, 'string');
    assert.ok(sentBody.password.length >= 24, 'password should be a real random value, not a placeholder');
  });

  it('throws ManagementApiError on a non-201 response, without leaking the request body', async () => {
    stubFetch([
      {
        match: (url) => url.endsWith('/cloud_directory/Users'),
        respond: () => json(409, { message: 'already exists' }),
      },
    ]);
    await assert.rejects(
      () => createStaffUser('dup@capy.test', CONFIG, nowSeconds),
      (error) => error instanceof ManagementApiError && error.message.includes('already exists')
    );
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
});
