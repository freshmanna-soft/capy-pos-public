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
  DUPLICATE_EMAIL_MESSAGE,
  PASSWORD_POLICY_MESSAGE,
  createCustomerSignupHandler,
  customerSignupConfigured,
  signupRefusal,
} from './customer-signup.ts';
import { ManagementApiError } from './management-api.ts';

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

// ---------------------------------------------------------------------------
// Item 8b: the two rejected sign-ups
// ---------------------------------------------------------------------------

/** How App ID reports the failure, as `createUser` now packages it. */
function upstream(status, detail) {
  return new ManagementApiError(`Creating the App ID user failed: ${detail ?? `status ${status}`}`, {
    status,
    detail,
  });
}

/** A `createUser` that fails the way App ID would, for a handler-level assertion. */
function createUserFails(error) {
  return {
    createUser: async (email, password, config) => {
      calls.push({ call: 'createUser', email, password, config });
      throw error;
    },
  };
}

describe('signupRefusal — duplicate email', () => {
  // This is the decision, pinned. Changing any of these three assertions is
  // changing what this route tells an unauthenticated caller about who has an
  // account here, which is a security decision and has to be made on purpose —
  // see `customer-signup.ts`'s header for the argument this pins.
  it('answers 409 with one fixed message, and #253\'s uniform-outcome path is deliberately NOT what this route does', () => {
    const refusal = signupRefusal(upstream(409, 'The email address already exists.'), REQUEST.email);

    assert.equal(refusal.status, 409, 'a duplicate is answered distinguishably, on purpose');
    assert.equal(refusal.body.error, DUPLICATE_EMAIL_MESSAGE);
  });

  it('never quotes the address, the existing account, or App ID back at the caller', () => {
    const refusal = signupRefusal(
      upstream(409, `A user with email ${REQUEST.email} already exists (profileId 9c1f).`),
      REQUEST.email
    );

    assert.equal(refusal.body.error.includes(REQUEST.email), false);
    assert.equal(/9c1f/.test(refusal.body.error), false);
    assert.equal(/App ID|profileId/i.test(refusal.body.error), false);
  });

  it('recognises a conflict a tenant reported as a 400 by its wording too', () => {
    for (const detail of [
      'The email address already exists',
      'That email is already registered',
      'Email already taken',
    ]) {
      assert.equal(signupRefusal(upstream(400, detail), REQUEST.email).status, 409, detail);
    }
  });

  it('says to *try* signing in — a fresh account is PENDING and a session is never implied', () => {
    assert.match(DUPLICATE_EMAIL_MESSAGE, /try signing in/i);
    assert.equal(/token|signed in|logged in|session/i.test(DUPLICATE_EMAIL_MESSAGE), false);
  });
});

describe('signupRefusal — password policy', () => {
  it('answers 400 with the tenant policy\'s own words appended to a usable lead', () => {
    const refusal = signupRefusal(
      upstream(400, 'Password must be at least 12 characters and contain a digit'),
      REQUEST.email
    );

    assert.equal(refusal.status, 400);
    assert.equal(
      refusal.body.error,
      `${PASSWORD_POLICY_MESSAGE} Password must be at least 12 characters and contain a digit.`
    );
  });

  it('falls back to the fixed lead rather than forwarding a raw upstream blob', () => {
    for (const detail of [
      '{"scimType":"invalidValue","detail":"password too weak"}',
      `password rejected: ${'x'.repeat(400)}`,
      '<html>password error</html>',
    ]) {
      assert.equal(
        signupRefusal(upstream(400, detail), REQUEST.email).body.error,
        PASSWORD_POLICY_MESSAGE,
        detail.slice(0, 40)
      );
    }
  });

  it('drops an explanation that quotes the caller\'s own address back', () => {
    const refusal = signupRefusal(
      upstream(400, `password for ${REQUEST.email} is too weak`),
      REQUEST.email
    );
    assert.equal(refusal.body.error, PASSWORD_POLICY_MESSAGE);
  });

  it('collapses a multi-line explanation into one readable line', () => {
    const refusal = signupRefusal(upstream(400, 'Password too short.\n\n  Minimum is 10.'), REQUEST.email);
    assert.equal(refusal.body.error, `${PASSWORD_POLICY_MESSAGE} Password too short. Minimum is 10.`);
  });
});

describe('signupRefusal — everything else is still an outage', () => {
  it('does not answer for a 500, a transport failure, or a non-Management error', () => {
    assert.equal(signupRefusal(upstream(500, 'Internal error'), REQUEST.email), null);
    assert.equal(signupRefusal(new ManagementApiError('App ID request failed: socket hang up'), REQUEST.email), null);
    assert.equal(signupRefusal(new Error('boom'), REQUEST.email), null);
  });

  it('does not turn an unrelated 400 into a password answer', () => {
    assert.equal(signupRefusal(upstream(400, 'userName is required'), REQUEST.email), null);
  });

  // Both wording signals are read under exactly one upstream status, and for the
  // same reason: an outage that happens to *mention* an account or a password is
  // still an outage, and telling a shopper "that email is taken" while the tenant
  // is down is both a lie and an enumeration answer nothing asked for.
  it('does not read a duplicate out of an outage that merely mentions an existing account', () => {
    for (const status of [500, 502, 503, 504]) {
      assert.equal(
        signupRefusal(upstream(status, 'backend error: email already exists in cache'), REQUEST.email),
        null,
        `status ${status}`
      );
    }
  });

  it('does not read a password refusal out of an outage that merely mentions a password', () => {
    for (const status of [500, 502, 503, 504]) {
      assert.equal(
        signupRefusal(upstream(status, 'password service unavailable'), REQUEST.email),
        null,
        `status ${status}`
      );
    }
  });

  it('reads neither wording signal when App ID never got far enough to have a status', () => {
    assert.equal(
      signupRefusal(new ManagementApiError('boom', { detail: 'email already exists' }), REQUEST.email),
      null
    );
    assert.equal(
      signupRefusal(new ManagementApiError('boom', { detail: 'password too weak' }), REQUEST.email),
      null
    );
  });

  it('still answers a 409 whatever it says — that status *is* the conflict, not a wording guess', () => {
    assert.equal(signupRefusal(upstream(409, undefined), REQUEST.email).status, 409);
    assert.equal(signupRefusal(upstream(409, 'conflict'), REQUEST.email).body.error, DUPLICATE_EMAIL_MESSAGE);
  });
});

describe('createCustomerSignupHandler — rejected sign-ups', () => {
  it('resolves the duplicate answer instead of throwing, and creates nothing to roll back', async () => {
    const handle = createCustomerSignupHandler(
      CONFIG,
      deps(createUserFails(upstream(409, 'The email address already exists.')))
    );

    const response = await handle(REQUEST);

    assert.equal(response.status, 409);
    assert.equal(response.body.error, DUPLICATE_EMAIL_MESSAGE);
    assert.deepEqual(
      calls.map((c) => c.call),
      ['resolveRoleId', 'createUser'],
      'no role is granted and no rollback is attempted — nothing was created'
    );
  });

  it('resolves the password answer instead of throwing', async () => {
    const handle = createCustomerSignupHandler(
      CONFIG,
      deps(createUserFails(upstream(400, 'Password does not meet the policy')))
    );

    const response = await handle(REQUEST);

    assert.equal(response.status, 400);
    assert.match(response.body.error, /password policy/i);
    assert.equal(
      calls.some((c) => c.call === 'deleteUserAndProfile'),
      false
    );
  });

  it('still throws for a failure that is this service\'s problem, so http.ts answers its generic 502', async () => {
    const handle = createCustomerSignupHandler(CONFIG, deps(createUserFails(upstream(500, 'Internal error'))));

    await assert.rejects(() => handle(REQUEST), /Creating the App ID user failed/);
  });

  it('leaves the happy path\'s contract exactly as item 8a shipped it', async () => {
    const handle = createCustomerSignupHandler(CONFIG, deps());

    assert.deepEqual(await handle(REQUEST), {
      status: 201,
      body: { id: 'profile-1', email: REQUEST.email },
    });
  });
});
