/**
 * The suite for the auth and CORS boundary.
 *
 * `session-guard.ts` is the only thing between an arbitrary caller and a metered
 * model on the shop's API key — and, on the relay side, a set of tools that change a
 * cart. So every one of its refusals is asserted here. Not to raise a coverage
 * number: a bound that no test exercises is a bound nobody has shown to hold, and
 * epic #195 exists because three services documented a boundary that was never
 * built. A documented-but-untested one is the same bug wearing a different hat.
 *
 * Three things are pinned beyond the unit behaviour, because the first review of this
 * story found the module written, deployed, wired into Terraform — and imported by
 * nothing:
 *
 * 1. `Permission` still matches the Angular app's `permission.constants.ts`.
 * 2. The two copies of this module are still byte-identical to each other.
 * 3. `server.ts` still *calls* it, and still does not answer
 *    `Access-Control-Allow-Origin: *`.
 *
 * (3) is the one that would have caught the defect. A unit test of `authorize` passes
 * perfectly well while nothing calls `authorize`.
 *
 * No network and no clock: every function here is pure in its arguments.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import {
  Permission,
  authorize,
  corsHeaders,
  originAllowed,
  readAllowedOrigins,
  readBearer,
  verifySessionToken,
} from './session-guard.ts';

const SECRET = 'capy-pos-local-jwt-secret-change-in-production';
const NOW = 1_800_000_000;
const ORIGINS = ['https://till.example.com', 'http://localhost:4200'];

/** Mint an HS256 JWT the way `SessionIssuer.issueFor` does, so the fixtures are real tokens. */
function mint(payload = {}, { secret = SECRET, header = { alg: 'HS256', typ: 'JWT' } } = {}) {
  const claims = {
    sub: 'op-1',
    tenantId: 'store-1',
    roles: ['operator'],
    permissions: [Permission.PROCESS_SALE],
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

/** This service's own `src/`, whichever of the two copies is running. */
const HERE = dirname(new URL(import.meta.url).pathname);

/**
 * The two copies, located from `infra/` rather than from "my sibling", so this file
 * stays byte-identical on both sides — which is the property it exists to assert.
 */
const COPIES = ['vision-proxy', 'clerk-agent-relay'].map((service) =>
  join(resolve(HERE, '..', '..'), service, 'src', 'session-guard.ts')
);

describe('Permission', () => {
  /**
   * `session-guard.ts` copies this string out of the Angular app rather than
   * importing it: a container has no path into `src/`. This test is what makes the
   * copy safe. The value travels inside a signed token, so a rename on the Angular
   * side that is not mirrored here would 403 a real till, and this fails instead.
   */
  it('matches src/app/core/domain/auth/permission.constants.ts exactly', () => {
    assert.deepEqual({ ...Permission }, { PROCESS_SALE: 'sale:process' });
  });

  /**
   * The permission is deliberately one every role carries (the hierarchy in
   * `permission.constants.ts` is additive from `OPERATOR_PERMISSIONS` up). Requiring
   * something narrower would lock a manager out of the camera; requiring nothing
   * would let a token minted for something that is not a till spend the model key.
   */
  it('is the sell permission, not an administrative one', () => {
    assert.equal(Permission.PROCESS_SALE, 'sale:process');
    const operator = mint({ roles: ['operator'], permissions: ['sale:process'] });
    assert.equal(authorize(bearer(operator), Permission.PROCESS_SALE, SECRET, NOW).ok, true);
  });
});

describe('the copy in the sibling service', () => {
  /**
   * The module is duplicated because each service is a standalone container with its
   * own `tsconfig` `rootDir`, and TypeScript refuses to compile a source file from
   * outside it (TS6059). A copy is only safe if drift is loud, so: byte-for-byte.
   */
  it('is byte-identical to this one', () => {
    const [vision, relay] = COPIES.map((path) => readFileSync(path, 'utf8'));
    assert.equal(
      vision,
      relay,
      'infra/vision-proxy and infra/clerk-agent-relay copies of session-guard.ts have drifted — ' +
        'apply the change to both.'
    );
  });

  it('has an identical suite on both sides, so neither copy is checked less', () => {
    const suites = COPIES.map((path) => readFileSync(path.replace(/\.ts$/, '.test.mjs'), 'utf8'));
    assert.equal(suites[0], suites[1], 'the two session-guard.test.mjs files have drifted — apply the change to both.');
  });
});

describe('the boundary is wired into server.ts', () => {
  const server = readFileSync(join(HERE, 'server.ts'), 'utf8');

  /**
   * The regression test for this story's first review: the guard existed, Terraform
   * bound `SESSION_JWT_SECRET` and `ALLOWED_ORIGINS` into both apps, and no line of
   * either service imported any of it. Dead code cannot be a boundary.
   */
  it('imports the guard', () => {
    assert.match(server, /from '\.\/session-guard\.ts'/, 'server.ts does not import session-guard.ts');
  });

  it('calls authorize on the request', () => {
    assert.match(server, /authorize\(\s*req\.headers\.authorization/, 'server.ts does not call authorize()');
  });

  it('requires the permission rather than merely authenticating', () => {
    assert.match(server, /Permission\.PROCESS_SALE/);
  });

  it('never answers Access-Control-Allow-Origin: *', () => {
    // The literal this story exists to remove. `corsHeaders` echoes one allow-listed
    // origin instead, so a wildcard reappearing means the allow-list was bypassed.
    assert.doesNotMatch(server, /'Access-Control-Allow-Origin':\s*'\*'/);
    assert.doesNotMatch(server, /Access-Control-Allow-Origin["']?\s*:\s*["']\*/);
  });

  it('derives its CORS headers and its origin list from the guard', () => {
    assert.match(server, /corsHeaders\(/);
    assert.match(server, /originAllowed\(/);
    assert.match(server, /readAllowedOrigins\(process\.env\['ALLOWED_ORIGINS'\]\)/);
  });

  it('refuses to start without a secret or an origin list, rather than 503-ing every call', () => {
    // The docblock in session-guard.ts claims this. The claim being false in review
    // is why this test exists.
    assert.match(server, /SESSION_JWT_SECRET/);
    assert.match(server, /process\.exit\(1\)/);
    const exits = server.match(/process\.exit\(1\)/g) ?? [];
    assert.equal(exits.length, 2, 'expected both the missing-secret and missing-origins paths to exit');
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
  it('returns the claims a proxy reads from a genuine session token', () => {
    const claims = verifySessionToken(mint(), SECRET, NOW);
    assert.deepEqual(claims, {
      operatorId: 'op-1',
      tenantId: 'store-1',
      roles: ['operator'],
      permissions: ['sale:process'],
      expiresAt: NOW + 3600,
    });
  });

  it('ignores claims it does not read, so a richer token still verifies', () => {
    // `SessionIssuer` also sends `memberships`; a proxy has no use for it and must
    // not start failing when the browser adds another claim.
    const claims = verifySessionToken(mint({ memberships: [{ tenantId: 'store-1', role: 'manager' }] }), SECRET, NOW);
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
    });

    it('refuses algorithm substitution even when the HMAC is correct', () => {
      // The classic confusion: claim RS256, sign with HMAC anyway. The signature here
      // genuinely verifies, so only the pinned `alg` check rejects it.
      assert.equal(verifySessionToken(mint({}, { header: { alg: 'RS256' } }), SECRET, NOW), null);
      assert.equal(verifySessionToken(mint({}, { header: { alg: 'HS512' } }), SECRET, NOW), null);
      assert.equal(verifySessionToken(mint({}, { header: { alg: 'hs256' } }), SECRET, NOW), null);
    });

    it('refuses a tampered payload', () => {
      const [header, , signature] = mint().split('.');
      const escalated = Buffer.from(
        JSON.stringify({ sub: 'op-1', tenantId: 'store-1', permissions: ['sale:process'], exp: NOW + 3600 })
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
      const claims = verifySessionToken(mint({ roles: 'operator', permissions: ['sale:process', 7, null] }), SECRET, NOW);
      assert.deepEqual(claims?.roles, []);
      assert.deepEqual(claims?.permissions, ['sale:process']);
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
      'no tenant': bearer(mint({ tenantId: '' })),
    };
    for (const [label, header] of Object.entries(cases)) {
      const outcome = authorize(header, Permission.PROCESS_SALE, SECRET, NOW);
      assert.equal(outcome.ok, false, label);
      assert.equal(outcome.status, 401, label);
      // One body for all of them on purpose: distinguishing "expired" from "forged"
      // is a probing oracle, and the till's recovery is the same either way.
      assert.equal(outcome.error, 'Authorization required.', label);
    }
  });

  it('answers 403 naming the missing permission when the caller is authenticated', () => {
    // A token minted for something that is not a till: signed, unexpired, and not
    // allowed to sell. This is the case that makes the permission check worth having
    // on top of authentication.
    const readOnly = mint({ roles: ['viewer'], permissions: ['inventory:view'] });
    const outcome = authorize(bearer(readOnly), Permission.PROCESS_SALE, SECRET, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 403);
    assert.equal(outcome.error, 'Requires sale:process.');
  });

  it('answers 503 when the deployment has no secret, and never 401', () => {
    // A missing secret is the service being broken, not the caller's token being bad.
    // Answering 401 would have every till show "please sign in again" for a fault
    // that no amount of signing in can fix.
    const outcome = authorize(bearer(mint()), Permission.PROCESS_SALE, '', NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.error, 'Auth is not configured.');
  });

  it('checks the secret before the token, so an unconfigured service cannot be probed', () => {
    const outcome = authorize(undefined, Permission.PROCESS_SALE, '', NOW);
    assert.equal(outcome.ok === false && outcome.status, 503);
  });
});

describe('readAllowedOrigins', () => {
  it('parses a comma-separated list, the way Terraform joins frontend_origins', () => {
    assert.deepEqual(readAllowedOrigins('https://a.example.com,https://b.example.com'), [
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('trims whitespace, strips trailing slashes and deduplicates', () => {
    // An `Origin` header never carries a path, so a list entry with a trailing slash
    // would silently match nothing.
    assert.deepEqual(readAllowedOrigins(' https://a.example.com/ , https://a.example.com ,https://b.example.com//'), [
      'https://a.example.com',
      'https://b.example.com',
    ]);
  });

  it('returns an empty list for anything unusable, which is what makes server.ts refuse to start', () => {
    for (const raw of [undefined, null, '', '   ', ',', ' , , ']) {
      assert.deepEqual(readAllowedOrigins(raw), [], `expected [] for ${JSON.stringify(raw)}`);
    }
  });
});

describe('originAllowed', () => {
  it('admits an allow-listed origin, with or without a trailing slash', () => {
    assert.equal(originAllowed('https://till.example.com', ORIGINS), true);
    assert.equal(originAllowed('https://till.example.com/', ORIGINS), true);
  });

  it('admits a request with no Origin at all, which still has to present a token', () => {
    // `curl`, `smoke.mjs` and any server-to-server caller send none. CORS is a
    // browser mechanism; the token is what bounds these.
    assert.equal(originAllowed(undefined, ORIGINS), true);
    assert.equal(originAllowed('', ORIGINS), true);
  });

  it('refuses an unlisted origin', () => {
    for (const origin of ['https://evil.example.com', 'http://till.example.com', 'https://till.example.com.evil.com']) {
      assert.equal(originAllowed(origin, ORIGINS), false, origin);
    }
  });

  it('refuses Origin: null rather than treating it as absent', () => {
    // What a sandboxed iframe or a `file://` page sends. It cannot be allow-listed,
    // and treating it as absent would let it in through the no-Origin door.
    assert.equal(originAllowed('null', ORIGINS), false);
  });

  it('refuses everything when the allow-list is empty', () => {
    assert.equal(originAllowed('https://till.example.com', []), false);
  });
});

describe('corsHeaders', () => {
  it('echoes the allow-listed origin and varies on it', () => {
    const headers = corsHeaders('https://till.example.com', ORIGINS, 'POST, OPTIONS');
    assert.equal(headers['Access-Control-Allow-Origin'], 'https://till.example.com');
    // Without `Vary: Origin` a shared cache can hand one origin's allow header to
    // another, which turns a correct allow-list into a wrong one.
    assert.equal(headers['Vary'], 'Origin');
  });

  it('never answers a wildcard, for any input', () => {
    for (const origin of ['https://till.example.com', 'https://evil.example.com', undefined, '', 'null', '*']) {
      const headers = corsHeaders(origin, ORIGINS, 'POST, OPTIONS');
      assert.notEqual(headers['Access-Control-Allow-Origin'], '*', `wildcard for ${JSON.stringify(origin)}`);
    }
  });

  it('omits the allow header for an unlisted origin, so a browser refuses the reply', () => {
    const headers = corsHeaders('https://evil.example.com', ORIGINS, 'POST, OPTIONS');
    assert.equal('Access-Control-Allow-Origin' in headers, false);
  });

  it('allows the Authorization header the till must send', () => {
    // A preflight that omits this makes the browser drop the header, and every call
    // then arrives unauthenticated — a 401 that looks like a broken login.
    const headers = corsHeaders('https://till.example.com', ORIGINS, 'POST, OPTIONS');
    assert.match(headers['Access-Control-Allow-Headers'], /Authorization/);
    assert.equal(headers['Access-Control-Allow-Methods'], 'POST, OPTIONS');
  });
});

// Made with Bob
