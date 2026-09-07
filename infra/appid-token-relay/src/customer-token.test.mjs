/**
 * The suite for `customer-token.ts`, with the token exchange stubbed — this file
 * asserts *which client* a customer sign-in is exchanged under and what happens
 * when that client is not configured, not that a real App ID tenant exists
 * (`relay.test.mjs` already covers the exchange itself).
 *
 * The case that matters most here is the negative one, and it is the reason this
 * module exists rather than a second `relay(...)` call inline in `server.ts`: a
 * customer must never be signed in under the *staff* client. Same tenant, but a
 * different App ID application — the client the grant is exchanged under is what
 * decides the scopes the resulting token carries, so reusing staff's credentials
 * would hand every self-checkout customer a staff-scoped token. There is no
 * fallback here for that reason, and the "unconfigured" tests below assert the
 * exchange is never even attempted rather than attempted with a half-built
 * `Authorization: Basic` header (which App ID would answer with an
 * `invalid_client` a customer would read as "wrong password").
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { CUSTOMER_TOKEN_ROUTE, createCustomerTokenHandler, customerClientConfigured } from './customer-token.ts';

const CONFIG = {
  region: 'us-south',
  tenantId: 'tenant-1',
  customerClientId: 'customer-client-1',
  customerClientSecret: 'customer-shh',
};

let calls;

beforeEach(() => {
  calls = [];
});

/** Stands in for `relay()`, recording the request and the client config it was handed. */
function exchange(answer = { status: 200, body: { access_token: 'a' } }) {
  return async (request, config) => {
    calls.push({ request, config });
    return answer;
  };
}

describe('CUSTOMER_TOKEN_ROUTE', () => {
  it('is the customer path, a sibling of the staff one rather than a variant of it', () => {
    assert.equal(CUSTOMER_TOKEN_ROUTE, '/appid/customer/token');
  });
});

describe('customerClientConfigured', () => {
  it('is true only when both the customer client id and its secret are present', () => {
    assert.equal(customerClientConfigured(CONFIG), true);
  });

  it('is false when either half is missing — a secret without an id is not usable', () => {
    assert.equal(customerClientConfigured({ ...CONFIG, customerClientId: '' }), false);
    assert.equal(customerClientConfigured({ ...CONFIG, customerClientSecret: '' }), false);
    assert.equal(customerClientConfigured({ ...CONFIG, customerClientId: '', customerClientSecret: '' }), false);
  });
});

describe('createCustomerTokenHandler — which client the grant is exchanged under', () => {
  it('exchanges under the customer client, in the same region and tenant as staff', async () => {
    const handle = createCustomerTokenHandler(CONFIG, exchange());
    await handle({ grantType: 'password', username: 'shopper@example.com', password: 'p' });
    assert.deepEqual(calls[0].config, {
      region: 'us-south',
      tenantId: 'tenant-1',
      clientId: 'customer-client-1',
      clientSecret: 'customer-shh',
    });
  });

  it('never exchanges under the staff client, even when one is also in scope', async () => {
    const handle = createCustomerTokenHandler(
      { ...CONFIG, clientId: 'staff-client-1', clientSecret: 'staff-shh' },
      exchange()
    );
    await handle({ grantType: 'password', username: 'shopper@example.com', password: 'p' });
    assert.equal(calls[0].config.clientId, 'customer-client-1');
    assert.equal(calls[0].config.clientSecret, 'customer-shh');
  });

  it('forwards a password grant unchanged', async () => {
    const handle = createCustomerTokenHandler(CONFIG, exchange());
    await handle({ grantType: 'password', username: 'shopper@example.com', password: 'secret' });
    assert.deepEqual(calls[0].request, {
      grantType: 'password',
      username: 'shopper@example.com',
      password: 'secret',
    });
  });

  it('forwards a refresh_token grant unchanged', async () => {
    const handle = createCustomerTokenHandler(CONFIG, exchange());
    await handle({ grantType: 'refresh_token', refreshToken: 'rt-1' });
    assert.deepEqual(calls[0].request, { grantType: 'refresh_token', refreshToken: 'rt-1' });
  });
});

describe("createCustomerTokenHandler — App ID's own answer", () => {
  it('resolves with a successful token response untouched', async () => {
    const body = { access_token: 'a', refresh_token: 'r', token_type: 'Bearer', expires_in: 3600 };
    const handle = createCustomerTokenHandler(CONFIG, exchange({ status: 200, body }));
    assert.deepEqual(await handle({ grantType: 'password', username: 'u', password: 'p' }), {
      status: 200,
      body,
    });
  });

  it("resolves with a real OAuth error verbatim — a wrong password is App ID answering, not this relay failing", async () => {
    const body = { error: 'invalid_grant', error_description: 'wrong password' };
    const handle = createCustomerTokenHandler(CONFIG, exchange({ status: 400, body }));
    assert.deepEqual(await handle({ grantType: 'password', username: 'u', password: 'bad' }), {
      status: 400,
      body,
    });
  });

  it('lets a transport failure propagate, for the boundary to turn into its own 502', async () => {
    const handle = createCustomerTokenHandler(CONFIG, async () => {
      throw new Error('App ID request failed: socket hang up');
    });
    await assert.rejects(() => handle({ grantType: 'password', username: 'u', password: 'p' }), /socket hang up/);
  });
});

describe('createCustomerTokenHandler — the customer client not configured', () => {
  for (const [label, overrides] of [
    ['no client id', { customerClientId: '' }],
    ['no client secret', { customerClientSecret: '' }],
    ['neither', { customerClientId: '', customerClientSecret: '' }],
  ]) {
    it(`rejects with ${label}, without spending an attempt against the tenant`, async () => {
      const handle = createCustomerTokenHandler({ ...CONFIG, ...overrides }, exchange());
      await assert.rejects(
        () => handle({ grantType: 'password', username: 'u', password: 'p' }),
        /APPID_CUSTOMER_CLIENT_ID/
      );
      assert.equal(calls.length, 0);
    });
  }

  it('does not fall back to the staff client when the customer one is missing', async () => {
    const handle = createCustomerTokenHandler(
      { ...CONFIG, customerClientId: '', customerClientSecret: '', clientId: 'staff-client-1', clientSecret: 'staff-shh' },
      exchange()
    );
    await assert.rejects(() => handle({ grantType: 'password', username: 'u', password: 'p' }));
    assert.equal(calls.length, 0);
  });
});
