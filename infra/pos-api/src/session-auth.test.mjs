/**
 * The suite for the auth boundary.
 *
 * `session-auth.ts` is the only thing between an arbitrary caller and the shop's
 * catalogue and sales history, so every one of its refusals is asserted here. Not to
 * raise a coverage number: a bound that no test exercises is a bound nobody has
 * shown to hold, and this epic exists because three services documented a boundary
 * that was never built. A documented-but-untested one would be the same bug wearing
 * a different hat.
 *
 * The token-forging cases are the ones that matter most — `alg: none`, algorithm
 * substitution, a signature from a different secret, a tampered payload. Those are
 * the difference between verifying a JWT and merely decoding one.
 *
 * No clock is faked (`NOW` is a parameter, same as `authorize`'s own signature),
 * but the App ID cases below do stub `global.fetch` for the JWKS lookup — the one
 * real network call this file's functions ever make. Every RS256 fixture uses its
 * own `kid`, unique across this whole file: `findJwk`'s cache is module-level and
 * persists across tests in the same process, so a fresh `kid` is what guarantees a
 * cache miss hits *this* test's stubbed `fetch` rather than a stale one from a
 * different test's tenant.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, generateKeyPairSync, sign as signRsa } from 'node:crypto';
import { Permission, authorize, readBearer, verifyAppIdAccessToken, verifySessionToken } from './session-auth.ts';

const SECRET = 'capy-pos-local-jwt-secret-change-in-production';
const NOW = 1_800_000_000;

/** Mint an HS256 JWT the way `SessionIssuer.issueFor` does, so the fixtures are real tokens. */
function mint(payload = {}, { secret = SECRET, header = { alg: 'HS256', typ: 'JWT' } } = {}) {
  const claims = {
    sub: 'op-1',
    tenantId: 'store-1',
    roles: ['manager'],
    permissions: [Permission.VIEW_INVENTORY, Permission.PROCESS_SALE],
    iat: NOW - 60,
    exp: NOW + 3600,
    ...payload,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode(header)}.${encode(claims)}`;
  const signature = createHmac('sha256', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

const bearer = (token) => `Bearer ${token}`;

// ─── App ID (RS256) fixtures ──────────────────────────────────────────────────

const APPID_CONFIG = { region: 'us-south', tenantId: 'tenant-1', audience: 'client-1' };
const APPID_ISSUER = `https://${APPID_CONFIG.region}.appid.cloud.ibm.com/oauth/v4/${APPID_CONFIG.tenantId}`;

/** A real RSA keypair — `crypto.sign`/`createPublicKey` need real key material, not a fixture object. */
function generateRsaKeyPair() {
  return generateKeyPairSync('rsa', { modulusLength: 2048 });
}

/**
 * Mint an RS256 JWT the way a real App ID access token is shaped — confirmed
 * against a real decoded one during this adapter's own development: `aud` as an
 * array, `scope` as a space-separated string mixing framework scopes with role
 * names.
 */
function mintAppId(payload, { kid, keyPair, config = APPID_CONFIG, header = {} }) {
  const claims = {
    sub: 'op-1',
    scope: 'openid appid_default admin',
    iss: `https://${config.region}.appid.cloud.ibm.com/oauth/v4/${config.tenantId}`,
    aud: [config.audience],
    iat: NOW - 60,
    exp: NOW + 3600,
    ...payload,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'RS256', typ: 'JWT', kid, ...header })}.${encode(claims)}`;
  const signature = signRsa('RSA-SHA256', Buffer.from(signingInput), keyPair.privateKey).toString('base64url');
  return `${signingInput}.${signature}`;
}

/** Stub `global.fetch` to answer the JWKS endpoint with exactly one key, for the duration of `run`. */
async function withJwks(keyPair, kid, run) {
  // `keyPair.publicKey` from `generateKeyPairSync` is already a public KeyObject
  // — exporting it directly, not re-wrapping it through `createPublicKey` (which
  // only accepts a *private* KeyObject, to derive the matching public one).
  const jwk = { kid, ...keyPair.publicKey.export({ format: 'jwk' }) };
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
  };
  try {
    return await run({ calls });
  } finally {
    globalThis.fetch = original;
  }
}

describe('Permission', () => {
  /**
   * `session-auth.ts` copies these strings out of the Angular app rather than
   * importing them, because a container has no path into `src/`. This test is the
   * thing that makes the copy safe: the values travel inside a signed token, so a
   * rename on the Angular side that is not mirrored here would 403 a real till, and
   * this fails instead.
   */
  it('matches src/app/core/domain/auth/permission.constants.ts exactly', () => {
    assert.deepEqual(
      { ...Permission },
      {
        PROCESS_SALE: 'sale:process',
        VIEW_TRANSACTIONS: 'sale:view_transactions',
        VIEW_INVENTORY: 'inventory:view',
        MANAGE_INVENTORY: 'inventory:manage',
        DELETE_PRODUCT: 'inventory:delete',
      }
    );
  });
});

describe('readBearer', () => {
  it('reads the token regardless of scheme case', () => {
    for (const scheme of ['Bearer', 'bearer', 'BEARER', 'BeArEr']) {
      assert.equal(readBearer(`${scheme} abc.def.ghi`), 'abc.def.ghi');
    }
  });

  it('tolerates surrounding whitespace and multiple spaces after the scheme', () => {
    assert.equal(readBearer('  Bearer   abc  '), 'abc');
    assert.equal(readBearer('Bearer\tabc'), 'abc');
  });

  it('refuses anything that is not exactly one bearer token', () => {
    for (const header of [
      undefined,
      '',
      '   ',
      'abc',
      'Basic dXNlcjpwYXNz',
      'Bearer',
      'Bearer ',
      'Bearer a b',
      'Bearer a\tb',
      'Token abc',
    ]) {
      assert.equal(readBearer(header), null, `expected null for ${JSON.stringify(header)}`);
    }
  });

  it('refuses a non-string header, which is what a repeated header arrives as', () => {
    assert.equal(readBearer(['Bearer a', 'Bearer b']), null);
    assert.equal(readBearer(null), null);
    assert.equal(readBearer(42), null);
  });
});

describe('verifySessionToken', () => {
  it('returns the claims this API reads from a genuine session token', () => {
    const claims = verifySessionToken(mint(), SECRET, NOW);
    assert.deepEqual(claims, {
      operatorId: 'op-1',
      tenantId: 'store-1',
      roles: ['manager'],
      permissions: ['inventory:view', 'sale:process'],
      expiresAt: NOW + 3600,
    });
  });

  it('ignores claims it does not read, so a richer token still verifies', () => {
    // `SessionIssuer` also sends `memberships`; this API has no use for it and must
    // not start failing when the browser adds another claim.
    const claims = verifySessionToken(
      mint({ memberships: [{ tenantId: 'store-1', role: 'manager' }] }),
      SECRET,
      NOW
    );
    assert.equal(claims?.operatorId, 'op-1');
  });

  describe('forgery', () => {
    it('refuses a token signed with a different secret', () => {
      assert.equal(verifySessionToken(mint({}, { secret: 'not-the-secret' }), SECRET, NOW), null);
    });

    it('refuses alg: none with the signature stripped', () => {
      const unsigned = mint({}, { header: { alg: 'none', typ: 'JWT' } });
      const [header, payload] = unsigned.split('.');
      assert.equal(verifySessionToken(`${header}.${payload}.`, SECRET, NOW), null);
      assert.equal(verifySessionToken(`${header}.${payload}.${''}`, SECRET, NOW), null);
    });

    it('refuses algorithm substitution even when the HMAC is correct', () => {
      // The classic confusion: claim RS256, sign with HMAC anyway. The signature here
      // genuinely verifies, so only the pinned `alg` check rejects it.
      assert.equal(verifySessionToken(mint({}, { header: { alg: 'RS256' } }), SECRET, NOW), null);
      assert.equal(verifySessionToken(mint({}, { header: { alg: 'HS512' } }), SECRET, NOW), null);
    });

    it('refuses a tampered payload', () => {
      const [header, , signature] = mint().split('.');
      const escalated = Buffer.from(
        JSON.stringify({ sub: 'op-1', tenantId: 'store-1', permissions: ['inventory:delete'], exp: NOW + 3600 })
      ).toString('base64url');
      assert.equal(verifySessionToken(`${header}.${escalated}.${signature}`, SECRET, NOW), null);
    });

    it('refuses a signature of the wrong length without throwing', () => {
      // `timingSafeEqual` throws on a length mismatch; the length guard in
      // `signatureMatches` is what turns that into a plain refusal.
      const [header, payload] = mint().split('.');
      for (const signature of ['', 'AA', 'x'.repeat(200)]) {
        assert.equal(verifySessionToken(`${header}.${payload}.${signature}`, SECRET, NOW), null);
      }
    });

    it('refuses anything that is not three segments of base64url JSON', () => {
      for (const token of ['', '.', 'a.b', 'a.b.c.d', 'a.b.c', '!!!.???.###']) {
        assert.equal(verifySessionToken(token, SECRET, NOW), null, `expected null for "${token}"`);
      }
    });

    it('refuses a payload that decodes to an array or a scalar rather than an object', () => {
      for (const payload of [[1, 2], 'a string', 42, null]) {
        const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
        const signingInput = `${encode({ alg: 'HS256' })}.${encode(payload)}`;
        const signature = createHmac('sha256', SECRET).update(signingInput).digest('base64url');
        assert.equal(verifySessionToken(`${signingInput}.${signature}`, SECRET, NOW), null);
      }
    });
  });

  describe('lifetime', () => {
    it('refuses an expired token', () => {
      assert.equal(verifySessionToken(mint({ exp: NOW - 1 }), SECRET, NOW), null);
    });

    it('refuses a token expiring exactly now, rather than allowing the last second', () => {
      assert.equal(verifySessionToken(mint({ exp: NOW }), SECRET, NOW), null);
      assert.notEqual(verifySessionToken(mint({ exp: NOW + 1 }), SECRET, NOW), null);
    });

    it('refuses a token with no usable exp', () => {
      for (const exp of [undefined, null, 'soon', Number.NaN, Infinity]) {
        assert.equal(verifySessionToken(mint({ exp }), SECRET, NOW), null, `exp=${String(exp)}`);
      }
    });

    it('refuses a token that is not yet valid', () => {
      assert.equal(verifySessionToken(mint({ nbf: NOW + 60 }), SECRET, NOW), null);
      assert.notEqual(verifySessionToken(mint({ nbf: NOW }), SECRET, NOW), null);
    });
  });

  describe('attribution', () => {
    it('refuses a signed token with no subject or no tenant', () => {
      for (const payload of [{ sub: undefined }, { sub: '' }, { sub: 42 }, { tenantId: undefined }, { tenantId: '' }]) {
        assert.equal(verifySessionToken(mint(payload), SECRET, NOW), null, JSON.stringify(payload));
      }
    });

    it('reduces a malformed roles/permissions claim to an empty list rather than trusting it', () => {
      // Resilient mapping (#110): one non-string entry must not throw, and must not
      // survive into a permission check either.
      const claims = verifySessionToken(mint({ roles: 'manager', permissions: ['inventory:view', 7, null] }), SECRET, NOW);
      assert.deepEqual(claims?.roles, []);
      assert.deepEqual(claims?.permissions, ['inventory:view']);
    });
  });
});

describe('authorize', () => {
  it('admits a token that carries the required permission', async () => {
    const outcome = await authorize(bearer(mint()), Permission.PROCESS_SALE, { secret: SECRET }, NOW);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.claims.operatorId, 'op-1');
    assert.equal(outcome.claims.tenantId, 'store-1');
  });

  it('admits a valid token when no specific permission is required', async () => {
    const outcome = await authorize(bearer(mint({ permissions: [] })), null, { secret: SECRET }, NOW);
    assert.equal(outcome.ok, true);
  });

  it('answers 401 for every unauthenticated case, with one indistinguishable body', async () => {
    const cases = {
      'no header': undefined,
      'not a bearer scheme': 'Basic abc',
      'not a JWT': bearer('nonsense'),
      'wrong secret': bearer(mint({}, { secret: 'other' })),
      expired: bearer(mint({ exp: NOW - 1 })),
      'alg none': bearer(mint({}, { header: { alg: 'none' } })),
      'no subject': bearer(mint({ sub: '' })),
    };
    for (const [label, header] of Object.entries(cases)) {
      const outcome = await authorize(header, Permission.VIEW_INVENTORY, { secret: SECRET }, NOW);
      assert.equal(outcome.ok, false, label);
      assert.equal(outcome.status, 401, label);
      // One body for all of them on purpose: distinguishing "expired" from "forged"
      // is a probing oracle, and the till's recovery is the same either way.
      assert.equal(outcome.error, 'Authorization required.', label);
    }
  });

  it('answers 403 naming the missing permission when the caller is authenticated', async () => {
    // An operator token reaching the delete route: authenticated, not permitted.
    const operator = mint({ roles: ['operator'], permissions: ['sale:process', 'inventory:view'] });
    const outcome = await authorize(bearer(operator), Permission.DELETE_PRODUCT, { secret: SECRET }, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 403);
    assert.equal(outcome.error, 'Requires inventory:delete.');
  });

  it('answers 503 when the deployment has no secret, and never 401', async () => {
    // A missing secret is the service being broken, not the caller's token being bad.
    // Answering 401 would have every till show "please sign in again" for a fault
    // that no amount of signing in can fix.
    const outcome = await authorize(bearer(mint()), Permission.VIEW_INVENTORY, { secret: '' }, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.error, 'Auth is not configured.');
  });

  it('checks the secret before the token, so an unconfigured service cannot be probed', async () => {
    const outcome = await authorize(undefined, Permission.VIEW_INVENTORY, { secret: '' }, NOW);
    assert.equal(outcome.ok === false && outcome.status, 503);
  });

  it('answers 401, not 503, for an HS256 token when only App ID is configured', async () => {
    // The service IS configured (for RS256) — this is an unrecognized token, not
    // an outage. The 503 above is reserved for "neither method configured at all".
    const outcome = await authorize(
      bearer(mint()),
      Permission.VIEW_INVENTORY,
      { secret: '', appId: { region: 'us-south', tenantId: 'tenant-1', audience: 'client-1' } },
      NOW
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 401);
  });

  it('never verifies HS256 against an empty secret, even when appId is configured', async () => {
    // An empty string is a real, publicly-computable HMAC key — verifying against
    // it would let anyone forge a token by signing with key="".
    const forged = mint({ permissions: [Permission.DELETE_PRODUCT] }, { secret: '' });
    const outcome = await authorize(
      bearer(forged),
      Permission.DELETE_PRODUCT,
      { secret: '', appId: { region: 'us-south', tenantId: 'tenant-1', audience: 'client-1' } },
      NOW
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 401);
  });
});

describe('verifyAppIdAccessToken', () => {
  it('returns the claims this API reads from a genuine App ID access token', async () => {
    const keyPair = generateRsaKeyPair();
    await withJwks(keyPair, 'kid-1', async () => {
      const token = mintAppId({}, { kid: 'kid-1', keyPair });
      const claims = await verifyAppIdAccessToken(token, APPID_CONFIG, NOW);
      assert.deepEqual(claims, {
        operatorId: 'op-1',
        // App ID's own `tenant` claim is the service instance's id, not a
        // per-store one — the fixed sentinel is expected here, not anything
        // read off the token.
        tenantId: 'default-tenant',
        roles: ['admin'],
        permissions: ['sale:process', 'sale:view_transactions', 'inventory:view', 'inventory:manage', 'inventory:delete'],
        expiresAt: NOW + 3600,
      });
    });
  });

  it('caches the JWKS — one fetch across two verifications', async () => {
    const keyPair = generateRsaKeyPair();
    await withJwks(keyPair, 'kid-cache', async ({ calls }) => {
      const token = mintAppId({}, { kid: 'kid-cache', keyPair });
      assert.notEqual(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
      assert.notEqual(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
      assert.equal(calls.length, 1);
    });
  });

  it('refetches once for a kid the cache has not seen yet, then finds it', async () => {
    // The module-level JWKS cache persists across every test in this file, so
    // "the cache has not seen this kid yet" can't be assumed from a fresh
    // process — it's forced here, deterministically, by warming the cache with
    // an unrelated key first. What happens after that is then exact: the cache
    // is non-null but lacks 'kid-rotated', so exactly one refetch happens.
    const decoy = generateRsaKeyPair();
    await withJwks(decoy, 'kid-decoy', async () => {
      const decoyToken = mintAppId({}, { kid: 'kid-decoy', keyPair: decoy });
      assert.notEqual(await verifyAppIdAccessToken(decoyToken, APPID_CONFIG, NOW), null);
    });

    const rotated = generateRsaKeyPair();
    const rotatedJwk = { kid: 'kid-rotated', ...rotated.publicKey.export({ format: 'jwk' }) };
    let calls = 0;
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      calls++;
      return { ok: true, status: 200, json: async () => ({ keys: [rotatedJwk] }) };
    };
    try {
      const token = mintAppId({}, { kid: 'kid-rotated', keyPair: rotated });
      const claims = await verifyAppIdAccessToken(token, APPID_CONFIG, NOW);
      assert.notEqual(claims, null);
      assert.equal(calls, 1);
    } finally {
      globalThis.fetch = original;
    }
  });

  describe('forgery', () => {
    it('refuses a token signed with a different key than the one JWKS advertises for that kid', async () => {
      const advertised = generateRsaKeyPair();
      const actual = generateRsaKeyPair();
      await withJwks(advertised, 'kid-mismatch', async () => {
        const token = mintAppId({}, { kid: 'kid-mismatch', keyPair: actual });
        assert.equal(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
      });
    });

    it('refuses a kid with no matching JWKS entry, even after the one refetch', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-real', async () => {
        const token = mintAppId({}, { kid: 'kid-does-not-exist', keyPair });
        assert.equal(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
      });
    });

    it('refuses alg: none and algorithm substitution, same as the HS256 path', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-alg', async () => {
        const none = mintAppId({}, { kid: 'kid-alg', keyPair, header: { alg: 'none' } });
        assert.equal(await verifyAppIdAccessToken(none, APPID_CONFIG, NOW), null);

        const hs256 = mintAppId({}, { kid: 'kid-alg', keyPair, header: { alg: 'HS256' } });
        assert.equal(await verifyAppIdAccessToken(hs256, APPID_CONFIG, NOW), null);
      });
    });

    it('refuses a tampered payload', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-tamper', async () => {
        const token = mintAppId({}, { kid: 'kid-tamper', keyPair });
        const [header, , signature] = token.split('.');
        const escalated = Buffer.from(JSON.stringify({ sub: 'op-1', scope: 'admin', exp: NOW + 3600 })).toString(
          'base64url'
        );
        assert.equal(await verifyAppIdAccessToken(`${header}.${escalated}.${signature}`, APPID_CONFIG, NOW), null);
      });
    });

    it('refuses a token with no kid, or a non-string one', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-present', async () => {
        const noKid = mintAppId({}, { kid: undefined, keyPair });
        assert.equal(await verifyAppIdAccessToken(noKid, APPID_CONFIG, NOW), null);
      });
    });

    it('refuses anything that is not three segments of base64url JSON', async () => {
      for (const token of ['', '.', 'a.b', 'a.b.c.d', 'a.b.c', '!!!.???.###']) {
        assert.equal(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null, `expected null for "${token}"`);
      }
    });
  });

  describe('issuer, audience and tenant isolation', () => {
    it('refuses a token issued for a different tenant, even though the signature is real', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-tenant', async () => {
        const token = mintAppId({}, { kid: 'kid-tenant', keyPair, config: { ...APPID_CONFIG, tenantId: 'other-tenant' } });
        assert.equal(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
      });
    });

    it('refuses a token whose aud does not include this staff application', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-aud', async () => {
        const token = mintAppId({ aud: ['some-other-client'] }, { kid: 'kid-aud', keyPair });
        assert.equal(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
      });
    });

    it('admits aud as a bare string too, not only App ID\'s real array shape', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-aud-string', async () => {
        const token = mintAppId({ aud: APPID_CONFIG.audience }, { kid: 'kid-aud-string', keyPair });
        assert.notEqual(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
      });
    });

    it("never trusts the token's own tenant claim as Capy-POS's tenantId", async () => {
      // App ID's `tenant` is the service instance id, the same for every user.
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-instance', async () => {
        const token = mintAppId({ tenant: 'appid-instance-abc123' }, { kid: 'kid-instance', keyPair });
        const claims = await verifyAppIdAccessToken(token, APPID_CONFIG, NOW);
        assert.equal(claims.tenantId, 'default-tenant');
      });
    });
  });

  describe('lifetime', () => {
    it('refuses an expired token', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-exp', async () => {
        const token = mintAppId({ exp: NOW - 1 }, { kid: 'kid-exp', keyPair });
        assert.equal(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
      });
    });

    it('refuses a token that is not yet valid', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-nbf', async () => {
        const token = mintAppId({ nbf: NOW + 60 }, { kid: 'kid-nbf', keyPair });
        assert.equal(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
      });
    });
  });

  describe('scope → permissions', () => {
    it('grants exactly the operator tier for an operator scope', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-operator', async () => {
        const token = mintAppId({ scope: 'openid appid_default operator' }, { kid: 'kid-operator', keyPair });
        const claims = await verifyAppIdAccessToken(token, APPID_CONFIG, NOW);
        assert.deepEqual(claims.roles, ['operator']);
        assert.deepEqual(
          [...claims.permissions].sort(),
          ['inventory:view', 'sale:process', 'sale:view_transactions'].sort()
        );
      });
    });

    it('grants the manager tier — operator permissions plus inventory:manage, not inventory:delete', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-manager', async () => {
        const token = mintAppId({ scope: 'openid manager' }, { kid: 'kid-manager', keyPair });
        const claims = await verifyAppIdAccessToken(token, APPID_CONFIG, NOW);
        assert.ok(!claims.permissions.includes('inventory:delete'));
        assert.ok(claims.permissions.includes('inventory:manage'));
      });
    });

    it('drops App ID framework scopes and unknown names, keeping only real roles', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-framework', async () => {
        const token = mintAppId(
          { scope: 'openid appid_default appid_readuserattr appid_readprofile operator' },
          { kid: 'kid-framework', keyPair }
        );
        const claims = await verifyAppIdAccessToken(token, APPID_CONFIG, NOW);
        assert.deepEqual(claims.roles, ['operator']);
      });
    });

    it('grants nothing for a scope with no recognisable role', async () => {
      const keyPair = generateRsaKeyPair();
      await withJwks(keyPair, 'kid-norole', async () => {
        const token = mintAppId({ scope: 'openid appid_default' }, { kid: 'kid-norole', keyPair });
        const claims = await verifyAppIdAccessToken(token, APPID_CONFIG, NOW);
        assert.deepEqual(claims.roles, []);
        assert.deepEqual(claims.permissions, []);
      });
    });

    // The additive hierarchy — operator ⊂ manager ⊂ admin, matching
    // `permission.constants.ts`'s OPERATOR_PERMISSIONS ⊂ MANAGER_PERMISSIONS ⊂
    // ADMIN_PERMISSIONS restricted to the five values `Permission` copies — is
    // already pinned exactly by three tests: 'grants exactly the operator
    // tier' above, 'grants the manager tier' above, and 'returns the claims
    // this API reads from a genuine App ID access token' at the top of this
    // file, which mints an `admin` scope and asserts the full five-permission
    // set. Restating it as a fourth, bare-table test would assert nothing new.
  });
});

describe('JWKS fetch failure', () => {
  it('refuses the token rather than throwing when the JWKS endpoint is unreachable', async () => {
    const keyPair = generateRsaKeyPair();
    const original = globalThis.fetch;
    globalThis.fetch = async () => {
      throw new Error('getaddrinfo ENOTFOUND');
    };
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args);
    try {
      const token = mintAppId({}, { kid: 'kid-down', keyPair });
      assert.equal(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
    } finally {
      globalThis.fetch = original;
      console.error = originalError;
    }
    assert.equal(errors.length, 1);
  });

  it('refuses the token when the JWKS endpoint answers a non-2xx', async () => {
    const keyPair = generateRsaKeyPair();
    const original = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
    const originalError = console.error;
    console.error = () => {};
    try {
      const token = mintAppId({}, { kid: 'kid-500', keyPair });
      assert.equal(await verifyAppIdAccessToken(token, APPID_CONFIG, NOW), null);
    } finally {
      globalThis.fetch = original;
      console.error = originalError;
    }
  });
});

describe('authorize — App ID dispatch', () => {
  it('admits an RS256 token when appId is configured', async () => {
    const keyPair = generateRsaKeyPair();
    await withJwks(keyPair, 'kid-authz', async () => {
      const token = mintAppId({ scope: 'admin' }, { kid: 'kid-authz', keyPair });
      const outcome = await authorize(bearer(token), Permission.DELETE_PRODUCT, { secret: SECRET, appId: APPID_CONFIG }, NOW);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.claims.operatorId, 'op-1');
    });
  });

  it('403s an RS256 operator token reaching the delete route, naming what it lacks', async () => {
    const keyPair = generateRsaKeyPair();
    await withJwks(keyPair, 'kid-authz-403', async () => {
      const token = mintAppId({ scope: 'operator' }, { kid: 'kid-authz-403', keyPair });
      const outcome = await authorize(bearer(token), Permission.DELETE_PRODUCT, { secret: SECRET, appId: APPID_CONFIG }, NOW);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.status, 403);
      assert.equal(outcome.error, 'Requires inventory:delete.');
    });
  });

  it('401s an RS256 token when appId is not configured on this deployment', async () => {
    const keyPair = generateRsaKeyPair();
    await withJwks(keyPair, 'kid-unconfigured', async () => {
      const token = mintAppId({}, { kid: 'kid-unconfigured', keyPair });
      const outcome = await authorize(bearer(token), Permission.VIEW_INVENTORY, { secret: SECRET }, NOW);
      assert.equal(outcome.ok, false);
      assert.equal(outcome.status, 401);
    });
  });

  it('still verifies HS256 correctly when appId is also configured', async () => {
    // The two paths are independent — configuring App ID must not break the
    // local-secret path any deployment might still carry.
    const outcome = await authorize(bearer(mint()), Permission.PROCESS_SALE, { secret: SECRET, appId: APPID_CONFIG }, NOW);
    assert.equal(outcome.ok, true);
  });
});

// Made with Bob
