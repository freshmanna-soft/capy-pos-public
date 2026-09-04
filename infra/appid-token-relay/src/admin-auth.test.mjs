/**
 * The suite for `admin-auth.ts` — same fixture style as
 * `infra/pos-api/src/session-auth.test.mjs` (real HMAC/RSA signatures, no
 * library), trimmed to this file's one permission and its own load-bearing
 * cases: who gets in, who doesn't, and why.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign as signRsa } from 'node:crypto';
import { Permission, authorize, readBearer } from './admin-auth.ts';

const SECRET = 'capy-pos-local-jwt-secret-change-in-production';
const NOW = 1_800_000_000;
const APPID_CONFIG = { region: 'us-south', tenantId: 'tenant-1', audience: 'client-1' };
const APPID_ISSUER = `https://${APPID_CONFIG.region}.appid.cloud.ibm.com/oauth/v4/${APPID_CONFIG.tenantId}`;

function mintHs256(payload = {}) {
  const claims = { sub: 'op-1', permissions: [Permission.MANAGE_OPERATORS], iat: NOW - 60, exp: NOW + 3600, ...payload };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  const signature = createHmac('sha256', SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

function generateRsaKeyPair() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

function mintAppId(payload, { kid, keyPair, header = {} }) {
  const claims = {
    sub: 'op-1',
    scope: 'openid appid_default admin',
    iss: APPID_ISSUER,
    aud: [APPID_CONFIG.audience],
    iat: NOW - 60,
    exp: NOW + 3600,
    ...payload,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'RS256', typ: 'JWT', kid, ...header })}.${encode(claims)}`;
  const signature = signRsa('RSA-SHA256', Buffer.from(signingInput), keyPair.privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

async function withJwks(keyPair, kid, run) {
  const jwk = { kid, ...keyPair.publicKey.export({ format: 'jwk' }) };
  const original = globalThis.fetch;
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ keys: [jwk] }) });
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

const bearer = (token) => `Bearer ${token}`;

describe('Permission', () => {
  it('matches admin:manage_operators, the same string permission.constants.ts assigns to MANAGE_OPERATORS', () => {
    assert.deepEqual({ ...Permission }, { MANAGE_OPERATORS: 'admin:manage_operators' });
  });
});

describe('readBearer', () => {
  it('reads the token and refuses a malformed header, same contract every copy of this shares', () => {
    assert.equal(readBearer('Bearer abc.def.ghi'), 'abc.def.ghi');
    assert.equal(readBearer(undefined), null);
    assert.equal(readBearer('abc.def.ghi'), null);
  });
});

describe('authorize — HS256', () => {
  it('admits a token whose permissions include MANAGE_OPERATORS', async () => {
    const outcome = await authorize(bearer(mintHs256()), { secret: SECRET }, NOW);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.claims.operatorId, 'op-1');
  });

  it('403s a valid token that lacks MANAGE_OPERATORS — authenticated, just not an admin', async () => {
    const outcome = await authorize(bearer(mintHs256({ permissions: ['sale:process'] })), { secret: SECRET }, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 403);
  });

  it('401s an expired token', async () => {
    const outcome = await authorize(bearer(mintHs256({ exp: NOW - 1 })), { secret: SECRET }, NOW);
    assert.deepEqual(outcome, { ok: false, status: 401, error: 'Authorization required.' });
  });

  it('401s a token signed with the wrong secret', async () => {
    const wrongSecret = 'a-completely-different-secret';
    const claims = { sub: 'op-1', permissions: [Permission.MANAGE_OPERATORS], iat: NOW - 60, exp: NOW + 3600 };
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
    const signature = createHmac('sha256', wrongSecret).update(signingInput).digest('base64url');
    const outcome = await authorize(bearer(`${signingInput}.${signature}`), { secret: SECRET }, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 401);
  });

  it('401s with no Authorization header at all', async () => {
    const outcome = await authorize(undefined, { secret: SECRET }, NOW);
    assert.deepEqual(outcome, { ok: false, status: 401, error: 'Authorization required.' });
  });

  it('503s when neither HS256 nor App ID is configured — a broken deployment, not a bad token', async () => {
    const outcome = await authorize(bearer(mintHs256()), { secret: '' }, NOW);
    assert.deepEqual(outcome, { ok: false, status: 503, error: 'Auth is not configured.' });
  });
});

describe('authorize — App ID (RS256)', () => {
  it('admits a real App ID admin token', async () => {
    const keyPair = generateRsaKeyPair();
    const kid = 'kid-admits';
    await withJwks(keyPair, kid, async () => {
      const token = mintAppId({}, { kid, keyPair });
      const outcome = await authorize(bearer(token), { secret: '', appId: APPID_CONFIG }, NOW);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.claims.operatorId, 'op-1');
    });
  });

  it('403s an App ID token whose scope has no admin — manager/operator never carry MANAGE_OPERATORS', async () => {
    const keyPair = generateRsaKeyPair();
    const kid = 'kid-403';
    await withJwks(keyPair, kid, async () => {
      const token = mintAppId({ scope: 'openid appid_default manager' }, { kid, keyPair });
      const outcome = await authorize(bearer(token), { secret: '', appId: APPID_CONFIG }, NOW);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.status, 403);
    });
  });

  it('401s a token minted for a different tenant (wrong issuer)', async () => {
    const keyPair = generateRsaKeyPair();
    const kid = 'kid-wrong-iss';
    await withJwks(keyPair, kid, async () => {
      const token = mintAppId({ iss: 'https://us-south.appid.cloud.ibm.com/oauth/v4/other-tenant' }, { kid, keyPair });
      const outcome = await authorize(bearer(token), { secret: '', appId: APPID_CONFIG }, NOW);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.status, 401);
    });
  });

  it('401s a token minted for a different client (wrong audience)', async () => {
    const keyPair = generateRsaKeyPair();
    const kid = 'kid-wrong-aud';
    await withJwks(keyPair, kid, async () => {
      const token = mintAppId({ aud: ['some-other-client'] }, { kid, keyPair });
      const outcome = await authorize(bearer(token), { secret: '', appId: APPID_CONFIG }, NOW);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.status, 401);
    });
  });

  it("401s a token signed by a key that isn't in the JWKS at all", async () => {
    const realKeyPair = generateRsaKeyPair();
    const forgedKeyPair = generateRsaKeyPair();
    const kid = 'kid-forged';
    await withJwks(realKeyPair, kid, async () => {
      const token = mintAppId({}, { kid, keyPair: forgedKeyPair });
      const outcome = await authorize(bearer(token), { secret: '', appId: APPID_CONFIG }, NOW);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.status, 401);
    });
  });

  it('401s an RS256 token when this deployment has no App ID config at all', async () => {
    const keyPair = generateRsaKeyPair();
    const token = mintAppId({}, { kid: 'kid-no-config', keyPair });
    const outcome = await authorize(bearer(token), { secret: SECRET }, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 401);
  });
});
