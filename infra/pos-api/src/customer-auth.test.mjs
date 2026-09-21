import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign as signRsa } from 'node:crypto';
import {
  authenticateOptionalCustomer,
  authenticateRequiredCustomer,
  deriveCustomerKey,
  verifyCustomerAccessToken,
} from './customer-auth.ts';

const NOW = 1_800_000_000;
const CONFIG = { region: 'us-south', tenantId: 'customer-tenant', audience: 'customer-client' };
const ISSUER = `https://${CONFIG.region}.appid.cloud.ibm.com/oauth/v4/${CONFIG.tenantId}`;

function mint(payload, { kid, keyPair, config = CONFIG }) {
  const claims = {
    sub: 'customer-subject',
    scope: 'openid appid_default customer',
    iss: `https://${config.region}.appid.cloud.ibm.com/oauth/v4/${config.tenantId}`,
    aud: [config.audience],
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

async function withJwks(entries, run) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    const entry = entries.find(({ issuer }) => url === `${issuer}/publickeys`);
    if (!entry) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => ({ keys: entry.keys }) };
  };
  try {
    return await run({ calls });
  } finally {
    globalThis.fetch = original;
  }
}

function keyEntry(issuer, kid, keyPair) {
  return { issuer, keys: [{ kid, ...keyPair.publicKey.export({ format: 'jwk' }) }] };
}

describe('customer-only App ID verification', () => {
  it('returns the minimal durable customer principal', async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = 'customer-principal-key';
    await withJwks([keyEntry(ISSUER, kid, keyPair)], async () => {
      const principal = await verifyCustomerAccessToken(mint({}, { kid, keyPair }), CONFIG, NOW);
      assert.deepEqual(principal, {
        issuer: ISSUER,
        subject: 'customer-subject',
        tenantId: 'default-tenant',
        customerKey: deriveCustomerKey({
          issuer: ISSUER,
          subject: 'customer-subject',
          tenantId: 'default-tenant',
        }),
        keyVersion: 'sha256-v1',
      });
    });
  });

  it('requires exact customer audience, issuer, subject, lifetime and scope', async () => {
    const keyPair = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = 'customer-refusal-key';
    await withJwks([keyEntry(ISSUER, kid, keyPair)], async () => {
      const invalidPayloads = [
        { aud: ['staff-client'] },
        { iss: `${ISSUER}-other` },
        { sub: '' },
        { exp: NOW },
        { nbf: NOW + 1 },
        { scope: 'openid appid_default' },
        { scope: ['customer'] },
      ];
      for (const payload of invalidPayloads) {
        assert.equal(
          await verifyCustomerAccessToken(mint(payload, { kid, keyPair }), CONFIG, NOW),
          null,
          JSON.stringify(payload)
        );
      }
    });
  });

  it('keeps JWKS caches isolated by issuer even when tenants reuse a kid', async () => {
    const first = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const second = generateKeyPairSync('rsa', { modulusLength: 2048 });
    const kid = 'shared-kid-across-tenants';
    const secondConfig = { ...CONFIG, tenantId: 'other-customer-tenant' };
    const secondIssuer = `https://${secondConfig.region}.appid.cloud.ibm.com/oauth/v4/${secondConfig.tenantId}`;
    await withJwks(
      [keyEntry(ISSUER, kid, first), keyEntry(secondIssuer, kid, second)],
      async ({ calls }) => {
        assert.notEqual(
          await verifyCustomerAccessToken(mint({}, { kid, keyPair: first }), CONFIG, NOW),
          null
        );
        assert.notEqual(
          await verifyCustomerAccessToken(
            mint({}, { kid, keyPair: second, config: secondConfig }),
            secondConfig,
            NOW
          ),
          null
        );
        assert.ok(calls.includes(`${ISSUER}/publickeys`));
        assert.ok(calls.includes(`${secondIssuer}/publickeys`));
      }
    );
  });
});

describe('optional checkout customer authentication', () => {
  it('treats only an absent header as guest', async () => {
    assert.deepEqual(await authenticateOptionalCustomer(undefined, undefined, NOW), {
      ok: true,
      principal: null,
    });
    assert.deepEqual(await authenticateOptionalCustomer('', CONFIG, NOW), {
      ok: false,
      status: 401,
      error: 'Customer authorization required.',
    });
    assert.deepEqual(await authenticateOptionalCustomer('Basic abc', CONFIG, NOW), {
      ok: false,
      status: 401,
      error: 'Customer authorization required.',
    });
  });

  it('fails a presented bearer closed when customer verification is unconfigured', async () => {
    assert.deepEqual(await authenticateOptionalCustomer('Bearer token', undefined, NOW), {
      ok: false,
      status: 503,
      error: 'Customer authentication is unavailable.',
    });
  });

  it('requires a customer on authenticated customer routes', async () => {
    assert.deepEqual(await authenticateRequiredCustomer(undefined, CONFIG, NOW), {
      ok: false,
      status: 401,
      error: 'Customer authorization required.',
    });
    assert.deepEqual(await authenticateRequiredCustomer('Bearer token', undefined, NOW), {
      ok: false,
      status: 503,
      error: 'Customer authentication is unavailable.',
    });
  });
});

describe('customer key derivation', () => {
  it('is stable and length-delimited across tuple boundaries', () => {
    const identity = { tenantId: 'default-tenant', issuer: ISSUER, subject: 'subject-1' };
    assert.equal(deriveCustomerKey(identity), deriveCustomerKey({ ...identity }));
    assert.notEqual(
      deriveCustomerKey({ tenantId: 'ab', issuer: 'c', subject: 'd' }),
      deriveCustomerKey({ tenantId: 'a', issuer: 'bc', subject: 'd' })
    );
  });
});
