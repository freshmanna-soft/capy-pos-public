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
 * 2. Every file that exists twice is still byte-identical to its twin.
 * 3. `server.ts` — the file the container runs — still builds its listener from
 *    `http.ts` rather than rolling a second boundary, and no wildcard origin has
 *    reappeared.
 * 4. `server.ts` still takes its body cap from the module that derives it, rather
 *    than writing the same expression a second time. The review after that one found
 *    exactly that: an exported cap nobody imported, next to a docblock claiming it
 *    could not drift.
 *
 * What this file does *not* do is prove that a request is refused. Greps cannot:
 * inverting `if (!outcome.ok)` satisfied every one of them in the round of review
 * that produced `http.test.mjs`, which starts a real server and sends real requests.
 * The two suites are complements — behaviour there, wiring and drift here.
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
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Permission,
  authorize,
  corsHeaders,
  originAllowed,
  readAllowedOrigins,
  readBearer,
  verifyAppIdAccessToken,
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

// ─── App ID (RS256) fixtures ──────────────────────────────────────────────────

const APPID_CONFIG = { region: 'us-south', tenantId: 'tenant-1', audience: 'client-1' };

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
    scope: 'openid appid_default operator',
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

/**
 * This service's own `src/`, whichever of the two copies is running.
 *
 * `fileURLToPath` rather than `new URL(import.meta.url).pathname`: a URL path is
 * percent-encoded, so a checkout under a directory with a space (or any other
 * escaped character) in it yields `.../POS%20197/src` — a path that does not exist,
 * failing every assertion below for a reason that has nothing to do with the code
 * under test. `fileURLToPath` decodes it, and is also the one that gets a Windows
 * drive letter right.
 */
const HERE = dirname(fileURLToPath(import.meta.url));

/** `infra/`, so the paths below do not depend on which copy is running. */
const INFRA = resolve(HERE, '..', '..');

/** The same filename in both services, located from `infra/` rather than "my sibling". */
const copiesOf = (file) => ['vision-proxy', 'clerk-agent-relay'].map((service) => join(INFRA, service, 'src', file));

/**
 * Every file that exists twice.
 *
 * The two boundary modules, and both their suites. The suites are in the list because
 * review found the coverage asymmetric — one service pinned its transport cap and its
 * sibling did not — and a suite that is only present on one side is exactly how that
 * happens again.
 */
const DUPLICATED = ['session-guard.ts', 'session-guard.test.mjs', 'http.ts', 'http.test.mjs'];

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
  it('is the sell permission, not an administrative one', async () => {
    assert.equal(Permission.PROCESS_SALE, 'sale:process');
    const operator = mint({ roles: ['operator'], permissions: ['sale:process'] });
    const outcome = await authorize(bearer(operator), Permission.PROCESS_SALE, { secret: SECRET }, NOW);
    assert.equal(outcome.ok, true);
  });
});

describe('the copies in the sibling service', () => {
  /**
   * These modules are duplicated because each service is a standalone container with
   * its own `tsconfig` `rootDir`, and TypeScript refuses to compile a source file
   * from outside it (TS6059). A copy is only safe if drift is loud, so: byte-for-byte,
   * suites included.
   */
  for (const file of DUPLICATED) {
    it(`${file} is byte-identical on both sides`, () => {
      const [vision, relay] = copiesOf(file).map((path) => readFileSync(path, 'utf8'));
      assert.equal(
        vision,
        relay,
        `infra/vision-proxy and infra/clerk-agent-relay copies of ${file} have drifted — ` +
          'apply the change to both.'
      );
    });
  }
});

describe('the boundary is wired into the process that spends the key', () => {
  const boundary = readFileSync(join(HERE, 'http.ts'), 'utf8');
  const server = readFileSync(join(HERE, 'server.ts'), 'utf8');

  /**
   * The regression test for this story's first review: the guard existed, Terraform
   * bound `SESSION_JWT_SECRET` and `ALLOWED_ORIGINS` into both apps, and no line of
   * either service imported any of it. Dead code cannot be a boundary — and
   * `http.test.mjs` exercising `createRequestListener` proves nothing about the
   * boundary if the deployed entry point does not use it.
   */
  it('is the module server.ts runs, not a second copy of the checks', () => {
    assert.match(server, /from '\.\/http\.ts'/, 'server.ts does not import http.ts');
    assert.match(
      server,
      /createServer\(\s*createRequestListener\(/,
      'server.ts does not build its listener from http.ts'
    );
    for (const field of ['route:', 'secret,', 'origins,', 'maxBodyBytes:', 'validate,', 'handle:']) {
      assert.ok(server.includes(field), `server.ts does not pass ${field} to createRequestListener`);
    }
    // A second boundary in the entry point is one `http.test.mjs` never sees.
    assert.doesNotMatch(server, /authorize\(\s*req\.headers/, 'server.ts authorizes on its own');
    assert.doesNotMatch(server, /req\.on\('data'/, 'server.ts reads bodies on its own');
  });

  /**
   * The regression test for this story's second review: both services exported a
   * `MAX_BODY_BYTES` derived from their own field cap, with a docblock claiming the
   * derivation was impossible to break by editing one file — and `server.ts` ignored
   * the export and wrote the identical expression again. Two definitions of one cap,
   * so changing the field cap moved one of them.
   *
   * Which number reaches the socket is the thing no other suite can see: `server.ts`
   * binds a port and `process.exit`s, so it is the one file here that cannot be
   * imported and called. `http.test.mjs` proves the 413 fires at whatever cap it is
   * handed; only this assertion says the deployed process hands it the derived one.
   * Module-agnostic because this file is byte-identical in both services: the vision
   * proxy derives its cap in `identify.ts`, the relay in `validate.ts`.
   */
  it('takes its body cap from the module that owns the field caps', () => {
    assert.match(
      server,
      /import \{[^}]*\bMAX_BODY_BYTES\b[^}]*\} from '\.\/(identify|validate)\.ts';/,
      'server.ts does not import MAX_BODY_BYTES from the module that derives it'
    );
    assert.match(
      server,
      /maxBodyBytes:\s*MAX_BODY_BYTES,/,
      'server.ts passes something other than the derived MAX_BODY_BYTES to the boundary'
    );
    assert.doesNotMatch(
      server,
      /(?:const|let|var)\s+MAX_BODY_BYTES\s*=/,
      'server.ts declares a second MAX_BODY_BYTES instead of using the imported one'
    );
  });

  it('authorizes on headers before reading a body, and requires the sell permission', () => {
    assert.match(boundary, /from '\.\/session-guard\.ts'/, 'http.ts does not import session-guard.ts');
    assert.match(boundary, /Permission\.PROCESS_SALE/, 'http.ts authenticates without requiring a permission');

    // Ordering, on the source. The socket suite proves each status; this proves the
    // cheap check still comes first, so an unauthenticated caller cannot make the
    // process buffer megabytes before being turned away.
    const authorizeAt = boundary.search(/authorize\(\s*req\.headers\.authorization/);
    const bodyAt = boundary.search(/req\.on\('data'/);
    assert.ok(authorizeAt > 0, 'http.ts does not call authorize() on the request headers');
    assert.ok(bodyAt > authorizeAt, 'http.ts reads the body before authorizing the caller');
  });

  it('never answers Access-Control-Allow-Origin: *', () => {
    // The literal this story exists to remove. `corsHeaders` echoes one allow-listed
    // origin instead, so a wildcard reappearing means the allow-list was bypassed.
    for (const [name, source] of [
      ['http.ts', boundary],
      ['server.ts', server],
    ]) {
      assert.doesNotMatch(source, /'Access-Control-Allow-Origin':\s*'\*'/, name);
      assert.doesNotMatch(source, /Access-Control-Allow-Origin["']?\s*:\s*["']\*/, name);
    }
  });

  it('derives its CORS headers and its origin list from the guard', () => {
    assert.match(boundary, /corsHeaders\(/);
    assert.match(boundary, /originAllowed\(/);
    assert.match(server, /readAllowedOrigins\(process\.env\['ALLOWED_ORIGINS'\]\)/);
  });

  it('refuses to start without a secret or an origin list, rather than 503-ing every call', () => {
    // The docblock in session-guard.ts claims this. The claim being false in review
    // is why this test exists. `http.test.mjs` covers the other half — that a secret
    // vanishing under a *running* process is a 503 and not a 401.
    assert.match(server, /SESSION_JWT_SECRET/);
    const exits = server.match(/process\.exit\(1\)/g) ?? [];
    // Missing secret, missing origins, a *partial* set of
    // APPID_REGION/APPID_TENANT_ID/APPID_CLIENT_ID, and (Phase 5) a *partial*
    // set of POS_API_INTERNAL_ROLES_URL/INTERNAL_API_SECRET — four
    // "refuse to guess" exits, not two.
    assert.equal(
      exits.length,
      4,
      'expected the missing-secret, missing-origins, partial-App-ID and partial-roles-source paths to all exit'
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
      'no tenant': bearer(mint({ tenantId: '' })),
    };
    for (const [label, header] of Object.entries(cases)) {
      const outcome = await authorize(header, Permission.PROCESS_SALE, { secret: SECRET }, NOW);
      assert.equal(outcome.ok, false, label);
      assert.equal(outcome.status, 401, label);
      // One body for all of them on purpose: distinguishing "expired" from "forged"
      // is a probing oracle, and the till's recovery is the same either way.
      assert.equal(outcome.error, 'Authorization required.', label);
    }
  });

  it('answers 403 naming the missing permission when the caller is authenticated', async () => {
    // A token minted for something that is not a till: signed, unexpired, and not
    // allowed to sell. This is the case that makes the permission check worth having
    // on top of authentication.
    const readOnly = mint({ roles: ['viewer'], permissions: ['inventory:view'] });
    const outcome = await authorize(bearer(readOnly), Permission.PROCESS_SALE, { secret: SECRET }, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 403);
    assert.equal(outcome.error, 'Requires sale:process.');
  });

  it('answers 503 when the deployment has no secret, and never 401', async () => {
    // A missing secret is the service being broken, not the caller's token being bad.
    // Answering 401 would have every till show "please sign in again" for a fault
    // that no amount of signing in can fix.
    const outcome = await authorize(bearer(mint()), Permission.PROCESS_SALE, { secret: '' }, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 503);
    assert.equal(outcome.error, 'Auth is not configured.');
  });

  it('checks the secret before the token, so an unconfigured service cannot be probed', async () => {
    const outcome = await authorize(undefined, Permission.PROCESS_SALE, { secret: '' }, NOW);
    assert.equal(outcome.ok === false && outcome.status, 503);
  });

  it('answers 401, not 503, for an HS256 token when only App ID is configured', async () => {
    // The service IS configured (for RS256) — this is an unrecognized token, not
    // an outage. The 503 above is reserved for "neither method configured at all".
    const outcome = await authorize(bearer(mint()), Permission.PROCESS_SALE, { secret: '', appId: APPID_CONFIG }, NOW);
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 401);
  });

  it('never verifies HS256 against an empty secret, even when appId is configured', async () => {
    // An empty string is a real, publicly-computable HMAC key — verifying against
    // it would let anyone forge a token by signing with key="".
    const forged = mint({ permissions: [Permission.PROCESS_SALE] }, { secret: '' });
    const outcome = await authorize(
      bearer(forged),
      Permission.PROCESS_SALE,
      { secret: '', appId: APPID_CONFIG },
      NOW
    );
    assert.equal(outcome.ok, false);
    assert.equal(outcome.status, 401);
  });
});

describe('verifyAppIdAccessToken', () => {
  it('returns the claims a proxy reads from a genuine App ID access token', async () => {
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
        roles: ['operator'],
        permissions: ['sale:process'],
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

    it("admits aud as a bare string too, not only App ID's real array shape", async () => {
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
    it('grants sale:process for every built-in role — the one permission this proxy needs', async () => {
      for (const role of ['operator', 'manager', 'admin']) {
        const keyPair = generateRsaKeyPair();
        await withJwks(keyPair, `kid-${role}`, async () => {
          const token = mintAppId({ scope: `openid appid_default ${role}` }, { kid: `kid-${role}`, keyPair });
          const claims = await verifyAppIdAccessToken(token, APPID_CONFIG, NOW);
          assert.deepEqual(claims.roles, [role], role);
          assert.deepEqual(claims.permissions, ['sale:process'], role);
        });
      }
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
  });
});

describe('shared roles document (Phase 5)', () => {
  // `rolesCache` is module-level, exactly like `jwksCache`, and persists across every
  // test in this file — but unlike the JWKS cache (keyed by `kid`, so a fresh kid per
  // test guarantees a miss regardless of what earlier tests cached) there is nothing
  // to key a roles fetch on: it is one document, one cache slot. So these four cases
  // are written as one deliberate sequence, each depending on the module state the
  // previous one left behind, in the order they run — not four independent tests that
  // happen to share a file. `nowSeconds` still advances between them so each is
  // unambiguous about which side of the 5-minute TTL it lands on.
  const ROLES_CONFIG = { ...APPID_CONFIG, rolesSource: { url: 'https://pos-api.internal/internal/roles', secret: 's' } };

  /** Answers the JWKS endpoint for real; routes anything else to `rolesResponder`. */
  async function withRolesFetch(keyPair, kid, rolesResponder, run) {
    const jwk = { kid, ...keyPair.publicKey.export({ format: 'jwk' }) };
    const calls = { roles: 0 };
    const original = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/publickeys')) {
        return { ok: true, status: 200, json: async () => ({ keys: [jwk] }) };
      }
      calls.roles++;
      return rolesResponder();
    };
    try {
      return await run(calls);
    } finally {
      globalThis.fetch = original;
    }
  }

  it('1. falls back to the local ROLE_PERMISSIONS table when the fetch fails and nothing has ever been cached', async () => {
    const keyPair = generateRsaKeyPair();
    const originalError = console.error;
    console.error = () => {};
    try {
      await withRolesFetch(
        keyPair,
        'kid-roles-1',
        () => ({ ok: false, status: 500, json: async () => ({}) }),
        async () => {
          const token = mintAppId({ scope: 'openid operator', exp: NOW + 1_000_000 + 3600 }, { kid: 'kid-roles-1', keyPair });
          const claims = await verifyAppIdAccessToken(token, ROLES_CONFIG, NOW + 1_000_000);
          // The local fallback table's own value for 'operator' — proves the failed
          // fetch degraded to it rather than granting nothing.
          assert.deepEqual(claims.permissions, ['sale:process']);
        }
      );
    } finally {
      console.error = originalError;
    }
  });

  it('2. uses the fetched document instead of the local fallback once a fetch succeeds', async () => {
    const keyPair = generateRsaKeyPair();
    await withRolesFetch(
      keyPair,
      'kid-roles-2',
      () => ({ ok: true, status: 200, json: async () => ({ roles: { operator: ['custom:permission'] } }) }),
      async (calls) => {
        const token = mintAppId({ scope: 'openid operator', exp: NOW + 2_000_100 + 3600 }, { kid: 'kid-roles-2', keyPair });
        const claims = await verifyAppIdAccessToken(token, ROLES_CONFIG, NOW + 2_000_000);
        // Not the local fallback's 'sale:process' — this can only be the fetched doc.
        assert.deepEqual(claims.permissions, ['custom:permission']);
        assert.equal(calls.roles, 1);
      }
    );
  });

  it('3. keeps serving the cached document within the TTL, without refetching', async () => {
    const keyPair = generateRsaKeyPair();
    await withRolesFetch(
      keyPair,
      'kid-roles-3',
      () => {
        throw new Error('must not be called — the cache from test 2 is still fresh');
      },
      async (calls) => {
        // 60s after test 2's fetch — well inside the 5-minute TTL.
        const token = mintAppId(
          { scope: 'openid operator', exp: NOW + 2_000_060 + 3600 },
          { kid: 'kid-roles-3', keyPair }
        );
        const claims = await verifyAppIdAccessToken(token, ROLES_CONFIG, NOW + 2_000_000 + 60);
        assert.deepEqual(claims.permissions, ['custom:permission']);
        assert.equal(calls.roles, 0, 'the roles endpoint should not have been hit at all');
      }
    );
  });

  it('4. keeps serving the last good cache, not the local fallback, when a post-TTL refetch fails', async () => {
    const keyPair = generateRsaKeyPair();
    const originalError = console.error;
    console.error = () => {};
    try {
      await withRolesFetch(
        keyPair,
        'kid-roles-4',
        () => ({ ok: false, status: 503, json: async () => ({}) }),
        async (calls) => {
          // 400s after test 2's fetch — past the 5-minute TTL, so this forces a
          // refetch attempt, which is made to fail here.
          const token = mintAppId(
            { scope: 'openid operator', exp: NOW + 2_000_400 + 3600 },
            { kid: 'kid-roles-4', keyPair }
          );
          const claims = await verifyAppIdAccessToken(token, ROLES_CONFIG, NOW + 2_000_000 + 400);
          // Test 2's cached document, not ROLE_PERMISSIONS' 'sale:process' and not empty.
          assert.deepEqual(claims.permissions, ['custom:permission']);
          assert.equal(calls.roles, 1, 'a stale cache should still trigger exactly one refetch attempt');
        }
      );
    } finally {
      console.error = originalError;
    }
  });

  it('never touches the roles endpoint at all when rolesSource is not configured', async () => {
    const keyPair = generateRsaKeyPair();
    await withRolesFetch(
      keyPair,
      'kid-roles-unconfigured',
      () => {
        throw new Error('must not be called — APPID_CONFIG has no rolesSource');
      },
      async (calls) => {
        const token = mintAppId(
          { scope: 'openid operator', exp: NOW + 3_000_000 + 3600 },
          { kid: 'kid-roles-unconfigured', keyPair }
        );
        const claims = await verifyAppIdAccessToken(token, APPID_CONFIG, NOW + 3_000_000);
        assert.deepEqual(claims.permissions, ['sale:process']);
        assert.equal(calls.roles, 0);
      }
    );
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
      const token = mintAppId({ scope: 'operator' }, { kid: 'kid-authz', keyPair });
      const outcome = await authorize(bearer(token), Permission.PROCESS_SALE, { secret: SECRET, appId: APPID_CONFIG }, NOW);
      assert.equal(outcome.ok, true);
      assert.equal(outcome.claims.operatorId, 'op-1');
    });
  });

  it('401s an RS256 token when appId is not configured on this deployment', async () => {
    const keyPair = generateRsaKeyPair();
    await withJwks(keyPair, 'kid-unconfigured', async () => {
      const token = mintAppId({}, { kid: 'kid-unconfigured', keyPair });
      const outcome = await authorize(bearer(token), Permission.PROCESS_SALE, { secret: SECRET }, NOW);
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
