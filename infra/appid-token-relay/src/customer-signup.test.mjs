/**
 * The suite for `customer-signup.ts`, with every Management API call stubbed —
 * this file asserts *what a customer sign-up is allowed to do* (create one
 * account, grant it exactly the `customer` role, in that order) and what happens
 * when the deployment cannot serve it, not that a real App ID tenant exists
 * (`management-api.test.mjs` already covers the calls themselves).
 *
 * The cases that matter most are the negative ones, and they are why this module
 * exists rather than an inline `createUser(...)` in `server.ts`: the caller is
 * unauthenticated, so a role they could nudge, or an account created before the
 * `customer` role was found to be missing, are both real self-service escalation
 * and half-registration paths. Both are asserted here, not just documented — as
 * is the third one ordering alone cannot close: an account created and then left
 * role-less because the *assignment* failed, which is rolled back rather than
 * abandoned.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_SCOPE,
  CUSTOMER_SIGNUP_ROUTE,
  createCustomerSignupHandler,
  customerSignupConfigured,
} from './customer-signup.ts';

const CONFIG = { region: 'us-south', tenantId: 'tenant-1', apiKey: 'iam-key-1' };
const REQUEST = { email: 'shopper@capy.test', password: 'chosen passphrase' };

let calls;

beforeEach(() => {
  calls = [];
});

/** Stands in for every Management API call this route can make, recording each one in order. */
function deps(overrides = {}) {
  return {
    resolveRoleId: async (scope, config) => {
      calls.push({ call: 'resolveRoleId', scope, config });
      return 'customer-role-1';
    },
    createUser: async (email, password, config) => {
      calls.push({ call: 'createUser', email, password, config });
      // Two ids, as the real `createUser` returns: the profile id role
      // operations use, and the Cloud Directory id a delete uses.
      return { id: 'profile-1', scimId: 'scim-1', email, displayName: email };
    },
    assignRole: async (userId, roleId, config) => {
      calls.push({ call: 'assignRole', userId, roleId, config });
    },
    deleteUserAndProfile: async (scimId, config) => {
      calls.push({ call: 'deleteUserAndProfile', scimId, config });
    },
    ...overrides,
  };
}

describe('CUSTOMER_SIGNUP_ROUTE', () => {
  it('is the customer self-registration path, a sibling of the customer token route', () => {
    assert.equal(CUSTOMER_SIGNUP_ROUTE, '/appid/customer/sign-up');
  });
});

describe('customerSignupConfigured', () => {
  it('is true when the Management API key is present', () => {
    assert.equal(customerSignupConfigured(CONFIG), true);
  });

  it('is false without it — customer accounts are created through the Management API, not a grant', () => {
    assert.equal(customerSignupConfigured({ ...CONFIG, apiKey: '' }), false);
  });
});

describe('createCustomerSignupHandler — the happy path', () => {
  it('creates the account with the caller-supplied password and grants it the customer role', async () => {
    const handle = createCustomerSignupHandler(CONFIG, deps());
    const response = await handle(REQUEST);

    assert.deepEqual(response, { status: 201, body: { id: 'profile-1', email: 'shopper@capy.test' } });
    assert.deepEqual(
      calls.map((c) => c.call),
      ['resolveRoleId', 'createUser', 'assignRole'],
      'a sign-up that worked deletes nothing — the rollback is the failure path only'
    );
  });

  it('passes the password through untouched — a customer must be able to sign in with what they typed', async () => {
    const handle = createCustomerSignupHandler(CONFIG, deps());
    await handle({ email: 'shopper@capy.test', password: '  spaced  pass  ' });
    const create = calls.find((c) => c.call === 'createUser');
    assert.equal(create.password, '  spaced  pass  ');
    assert.equal(create.email, 'shopper@capy.test');
  });

  it('resolves the role from the fixed customer scope, never from the request', async () => {
    const handle = createCustomerSignupHandler(CONFIG, deps());
    await handle({ ...REQUEST, scope: 'admin', roleId: 'admin-role-1' });
    assert.equal(calls.find((c) => c.call === 'resolveRoleId').scope, CUSTOMER_SCOPE);
    assert.equal(CUSTOMER_SCOPE, 'customer');
  });

  it('assigns exactly the resolved customer role to the account it just created', async () => {
    const handle = createCustomerSignupHandler(CONFIG, deps({ resolveRoleId: async () => 'resolved-role-9' }));
    await handle(REQUEST);
    const assign = calls.find((c) => c.call === 'assignRole');
    assert.deepEqual({ userId: assign.userId, roleId: assign.roleId }, { userId: 'profile-1', roleId: 'resolved-role-9' });
  });

  it('makes every call against the same Management config it was built with', async () => {
    const handle = createCustomerSignupHandler(CONFIG, deps());
    await handle(REQUEST);
    for (const call of calls) {
      assert.deepEqual(call.config, CONFIG);
    }
  });

  it('returns the profile id, which is the sub every later call about this customer keys off', async () => {
    const handle = createCustomerSignupHandler(
      CONFIG,
      deps({ createUser: async (email) => ({ id: 'sub-42', scimId: 'scim-42', email, displayName: email }) })
    );
    assert.deepEqual((await handle(REQUEST)).body, { id: 'sub-42', email: 'shopper@capy.test' });
  });
});

describe('createCustomerSignupHandler — the customer role not configured', () => {
  it('rejects without creating an account, rather than leaving a role-less customer behind', async () => {
    const handle = createCustomerSignupHandler(
      CONFIG,
      deps({
        resolveRoleId: async (scope, config) => {
          calls.push({ call: 'resolveRoleId', scope, config });
          return null;
        },
      })
    );
    await assert.rejects(() => handle(REQUEST), /customer/);
    assert.deepEqual(
      calls.map((c) => c.call),
      ['resolveRoleId']
    );
  });
});

describe('createCustomerSignupHandler — the Management API key not configured', () => {
  it('rejects without touching the tenant at all, for the boundary to turn into its own 502', async () => {
    const handle = createCustomerSignupHandler({ ...CONFIG, apiKey: '' }, deps());
    await assert.rejects(() => handle(REQUEST), /APPID_MANAGEMENT_APIKEY/);
    assert.equal(calls.length, 0);
  });
});

describe('createCustomerSignupHandler — a failing Management API call', () => {
  it('lets a creation failure propagate, and never assigns a role for an account that was not created', async () => {
    const handle = createCustomerSignupHandler(
      CONFIG,
      deps({
        createUser: async () => {
          throw new Error('Creating the App ID user failed: status 409');
        },
      })
    );
    await assert.rejects(() => handle(REQUEST), /409/);
    assert.equal(
      calls.some((c) => c.call === 'assignRole'),
      false
    );
  });

  it('never rolls back an account that was never created', async () => {
    const handle = createCustomerSignupHandler(
      CONFIG,
      deps({
        createUser: async () => {
          throw new Error('Creating the App ID user failed: status 409');
        },
      })
    );
    await assert.rejects(() => handle(REQUEST), /409/);
    assert.equal(
      calls.some((c) => c.call === 'deleteUserAndProfile'),
      false,
      'a 409 duplicate is someone else\u2019s existing account — deleting it would be the worst possible answer'
    );
  });
});

/**
 * Resolving the role before creating the account closes the "no `customer` role
 * configured" half-registration path, and nothing else: the assignment itself can
 * still fail on a tenant where the role exists. That leaves precisely the account
 * this route promises never to create — one that can sign in and gets a token with
 * no scope `pos-api` maps to — and the caller cannot recover from it either, since
 * retrying their own sign-up now collides with the account they don't know exists.
 */
describe('createCustomerSignupHandler — a failing role assignment', () => {
  const assignFails = {
    assignRole: async (userId, roleId, config) => {
      calls.push({ call: 'assignRole', userId, roleId, config });
      throw new Error('Assigning the App ID role returned 500.');
    },
  };

  it('deletes the account it just created, by its Cloud Directory id', async () => {
    const handle = createCustomerSignupHandler(CONFIG, deps(assignFails));
    await assert.rejects(() => handle(REQUEST));

    assert.deepEqual(
      calls.map((c) => c.call),
      ['resolveRoleId', 'createUser', 'assignRole', 'deleteUserAndProfile']
    );
    const rollback = calls.find((c) => c.call === 'deleteUserAndProfile');
    assert.equal(rollback.scimId, 'scim-1', 'the delete keys off the SCIM id, not the profile id');
    assert.deepEqual(rollback.config, CONFIG);
  });

  it('still reports the original failure rather than a 201 the account did not earn', async () => {
    const handle = createCustomerSignupHandler(CONFIG, deps(assignFails));
    await assert.rejects(
      () => handle(REQUEST),
      (error) => {
        assert.match(error.message, /500/, 'the assignment failure is what actually went wrong');
        assert.match(
          error.message,
          /deleted again/,
          'and the log line has to say the account did not survive it, or an operator goes looking for one'
        );
        return true;
      }
    );
  });

  it('names the account it could not clean up when the rollback fails too, without hiding why', async () => {
    const handle = createCustomerSignupHandler(
      CONFIG,
      deps({
        ...assignFails,
        deleteUserAndProfile: async (scimId, config) => {
          calls.push({ call: 'deleteUserAndProfile', scimId, config });
          throw new Error('Deleting the App ID user returned 403.');
        },
      })
    );

    await assert.rejects(
      () => handle(REQUEST),
      (error) => {
        assert.match(error.message, /profile-1/, 'an operator has to be able to find the account left behind');
        assert.match(error.message, /403/);
        assert.match(error.cause.message, /500/, 'the failure that started this is still readable');
        return true;
      }
    );
  });

  it('does not guess at a delete when App ID returned no Cloud Directory id, and says so', async () => {
    const handle = createCustomerSignupHandler(
      CONFIG,
      deps({
        ...assignFails,
        createUser: async (email) => ({ id: 'profile-1', scimId: '', email, displayName: email }),
      })
    );

    await assert.rejects(() => handle(REQUEST), /profile-1/);
    assert.equal(
      calls.some((c) => c.call === 'deleteUserAndProfile'),
      false
    );
  });

  it('reports no PII in the failure an operator will read out of the logs', async () => {
    const handle = createCustomerSignupHandler(
      CONFIG,
      deps({
        ...assignFails,
        deleteUserAndProfile: async () => {
          throw new Error('Deleting the App ID user returned 403.');
        },
      })
    );
    await assert.rejects(() => handle(REQUEST), (error) => !error.message.includes(REQUEST.email));
  });
});
