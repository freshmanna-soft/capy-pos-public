import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signRsa } from 'node:crypto';
import { deriveCustomerKey } from './customer-auth.ts';
import { CUSTOMER_LOYALTY_PATH, handleCustomerLoyaltyHttp } from './customer-loyalty-http.ts';

const NOW = 1_800_000_000;
const ISO = '2027-01-15T10:00:00.000Z';
const CONFIG = { region: 'us-south', tenantId: 'customer-tenant', audience: 'customer-client' };
const ISSUER = `https://${CONFIG.region}.appid.cloud.ibm.com/oauth/v4/${CONFIG.tenantId}`;

function mint(payload, { kid, keyPair }) {
  const claims = {
    sub: 'customer-subject',
    scope: 'openid appid_default customer',
    iss: ISSUER,
    aud: [CONFIG.audience],
    iat: NOW - 60,
    exp: NOW + 3600,
    ...payload,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'RS256', typ: 'JWT', kid })}.${encode(claims)}`;
  const signature = signRsa('RSA-SHA256', Buffer.from(signingInput), keyPair.privateKey).toString(
    'base64url'
  );
  return `${signingInput}.${signature}`;
}

async function withCustomerToken(payload, run) {
  const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = `loyalty-route-${Math.random()}`;
  const token = mint(payload, { kid, keyPair });
  const original = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (url !== `${ISSUER}/publickeys`) return { ok: false, status: 404, json: async () => ({}) };
    return {
      ok: true,
      status: 200,
      json: async () => ({ keys: [{ kid, ...keyPair.publicKey.export({ format: 'jwk' }) }] }),
    };
  };
  try {
    await run(token);
  } finally {
    globalThis.fetch = original;
  }
}

function request(authorization) {
  return { method: 'GET', path: CUSTOMER_LOYALTY_PATH, authorization };
}

function deps(profiles, customerAuth = CONFIG) {
  return {
    profiles,
    customerAuth,
    nowSeconds: () => NOW,
    nowIso: () => ISO,
  };
}

function profile(identity, status = 'active') {
  return {
    revision: '1-a',
    document: {
      id: identity.customerKey,
      kind: 'customer-loyalty-profile',
      schemaVersion: 1,
      identity,
      status,
      pointsBalance: 1250,
      tier: 'silver',
      lastAppliedSequence: 3,
      pendingAward: null,
      recoveryGeneration: 0,
      createdAt: '2027-01-01T00:00:00.000Z',
      updatedAt: ISO,
    },
  };
}

describe('GET /api/self-checkout/customer/loyalty', () => {
  it('requires a customer bearer and distinguishes an unconfigured verifier', async () => {
    assert.deepEqual(
      await handleCustomerLoyaltyHttp(request(undefined), deps({ read: async () => null })),
      { status: 401, body: { error: 'Customer authorization required.' } }
    );
    assert.deepEqual(
      await handleCustomerLoyaltyHttp(request('Bearer presented-token'), {
        ...deps({ read: async () => null }),
        customerAuth: undefined,
      }),
      { status: 503, body: { error: 'Customer authentication is unavailable.' } }
    );
  });

  it('rejects wrong-audience and non-customer tokens with the same neutral 401', async () => {
    for (const claims of [{ aud: ['staff-client'] }, { scope: 'openid appid_default operator' }]) {
      await withCustomerToken(claims, async (token) => {
        const response = await handleCustomerLoyaltyHttp(
          request(`Bearer ${token}`),
          deps({ read: async () => assert.fail('invalid credentials reached profile storage') })
        );
        assert.deepEqual(response, {
          status: 401,
          body: { error: 'Customer authorization required.' },
        });
      });
    }
  });

  it('derives the current subject and returns only the public projection', async () => {
    await withCustomerToken({}, async (token) => {
      let received;
      const response = await handleCustomerLoyaltyHttp(
        request(`Bearer ${token}`),
        deps({
          async read(identity) {
            received = identity;
            return profile(identity);
          },
        })
      );
      const expectedKey = deriveCustomerKey({
        issuer: ISSUER,
        subject: 'customer-subject',
        tenantId: 'default-tenant',
      });
      assert.equal(received.customerKey, expectedKey);
      assert.deepEqual(response, {
        status: 200,
        body: {
          status: 'available',
          pointsBalance: 1250,
          tier: 'silver',
          policyVersion: 'self-checkout-usd-v1',
          updatedAt: ISO,
        },
      });
      const wire = JSON.stringify(response.body);
      assert.doesNotMatch(wire, /customer-subject|customerKey|issuer|default-tenant/);
      assert.doesNotMatch(wire, new RegExp(expectedKey));
    });
  });

  it('projects a missing profile as a zero balance without creating one', async () => {
    await withCustomerToken({}, async (token) => {
      const response = await handleCustomerLoyaltyHttp(
        request(`Bearer ${token}`),
        deps({ read: async () => null })
      );
      assert.deepEqual(response, {
        status: 200,
        body: {
          status: 'available',
          pointsBalance: 0,
          tier: 'bronze',
          policyVersion: 'self-checkout-usd-v1',
          updatedAt: ISO,
        },
      });
    });
  });

  it('maps rebuilding and quarantined profiles to neutral customer states', async () => {
    await withCustomerToken({}, async (token) => {
      for (const [storedStatus, publicStatus] of [
        ['rebuilding', 'unavailable'],
        ['quarantined', 'manual-review'],
      ]) {
        const response = await handleCustomerLoyaltyHttp(
          request(`Bearer ${token}`),
          deps({ read: async (identity) => profile(identity, storedStatus) })
        );
        assert.equal(response.status, 200);
        assert.equal(response.body.status, publicStatus);
      }
    });
  });

  it('returns a neutral 503 when profile storage is unavailable', async () => {
    await withCustomerToken({}, async (token) => {
      const response = await handleCustomerLoyaltyHttp(
        request(`Bearer ${token}`),
        deps({ read: async () => Promise.reject(new Error('secret backend details')) })
      );
      assert.deepEqual(response, {
        status: 503,
        body: { error: 'Customer loyalty is unavailable.' },
      });
    });
  });

  it('does not claim other paths or methods', async () => {
    const context = deps({ read: async () => null });
    assert.equal(
      await handleCustomerLoyaltyHttp(
        { method: 'POST', path: CUSTOMER_LOYALTY_PATH, authorization: undefined },
        context
      ),
      null
    );
    assert.equal(
      await handleCustomerLoyaltyHttp(
        { method: 'GET', path: `${CUSTOMER_LOYALTY_PATH}/someone`, authorization: undefined },
        context
      ),
      null
    );
  });
});
