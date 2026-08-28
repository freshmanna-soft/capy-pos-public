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
 * No network and no clock: `authorize` is a pure function of its four arguments.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { Permission, authorize, readBearer, verifySessionToken } from './session-auth.ts';

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
  it('admits a token that carries the required permission', () => {
    const outcome = authorize(bearer(mint()), Permission.PROCESS_SALE, SECRET, NOW);
    assert.equal(outcome.ok, true);
    assert.equal(outcome.claims.operatorId, 'op-1');
    assert.equal(outcome.claims.tenantId, 'store-1');
  });

  it('admits a valid token when no specific permission is required', () => {
    const outcome = authorize(bearer(mint({ permissions: [] })), null, SECRET, NOW);
    assert.equal(outcome.ok, true);
  });

  it('answers 401 for every unauthenticated case, with one indistinguishable body', () => {
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
      const outcome = authorize(header, Permission.VIEW_INVENTORY, SECRET, NOW);
      assert.equal(outcome.ok, false, label);
      assert.equal(outcome.status, 401, label);
      // One body for all of them on purpose: distinguishing "expired" from "forged"
      // is a probing oracle, and the till's recovery is the same either way.
      assert.equal(outcome.error, 'Authorization required.', label);
    }
  });

  it('answers 403 naming the missing permission when the caller is authenticated', () => {
    // An operator token reaching the delete route: authenticated, not permitted.
    const operator = mint({ roles: ['operator'], permissions: ['sale:process', 'inventory:view'] });
    const outcome = authorize(bearer(operator), Permission.DELETE_PRODUCT, SECRET, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 403);
    assert.equal(outcome.error, 'Requires inventory:delete.');
  });

  it('answers 503 when the deployment has no secret, and never 401', () => {
    // A missing secret is the service being broken, not the caller's token being bad.
    // Answering 401 would have every till show "please sign in again" for a fault
    // that no amount of signing in can fix.
    const outcome = authorize(bearer(mint()), Permission.VIEW_INVENTORY, '', NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.error, 'Auth is not configured.');
  });

  it('checks the secret before the token, so an unconfigured service cannot be probed', () => {
    const outcome = authorize(undefined, Permission.VIEW_INVENTORY, '', NOW);
    assert.equal(outcome.ok === false && outcome.status, 503);
  });
});

// Made with Bob
