/**
 * The suite for the API Gateway boundary.
 *
 * ## Why this file exists
 *
 * `lambda.ts` used to be the boundary and had no suite at all: the vision proxy's
 * handler authorized nothing, the relay's checked that a bearer token was *present*,
 * and both said in prose "do not put a route in front of this". Story #207 puts a
 * route in front of both, so the prose is replaced by `proxy-handler.ts` — and a
 * boundary is only worth the tests that show it refusing.
 *
 * Every refusal below asserts the status *and* that `handle` — the metered call, the
 * thing the boundary exists to protect — was never reached. Those two assertions
 * together are what make the mutations that matter fail: invert the auth check and the
 * 401 cases stop being 401s; delete the cap and the 413 case is served; drop the origin
 * refusal and a cross-origin page bills the shop's key.
 *
 * The order the checks run in is asserted against `http.ts`'s, because the two
 * boundaries are the same order over different transports and the socket one is the
 * one with a suite that starts a real server. A divergence is a bug in whichever one
 * moved.
 *
 * No network, no clock, no model SDK: `proxy-handler.ts` takes its route, caps,
 * validator and downstream call as parameters, and this file is byte-identical in both
 * proxies — checked by the drift assertion in `session-guard.test.mjs`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProxyHandler, readProxyEnvironment } from './proxy-handler.ts';
import { Permission } from './session-guard.ts';
import { ALLOWED_METHODS } from './http.ts';

const SECRET = 'capy-pos-local-jwt-secret-change-in-production';
const NOW = 1_800_000_000;
const ALLOWED = 'https://till.example.com';
const ORIGINS = [ALLOWED, 'http://localhost:4200'];

/** The route the handler is configured with here. Each service passes its own. */
const ROUTE = '/service/route';

/** Small enough that the over-cap case is a few kilobytes rather than megabytes. */
const MAX_BODY = 2048;

/** Mint an HS256 JWT the way `SessionIssuer.issueFor` does, so the fixtures are real tokens. */
function mint(payload = {}, { secret = SECRET } = {}) {
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
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${signingInput}.${createHmac('sha256', secret).update(signingInput).digest('base64url')}`;
}

const TOKEN = mint();

/**
 * A handler plus the record of what reached its downstream.
 *
 * `handled` and `validated` are the half of every refusal that a status-code assertion
 * cannot see: a 403 that still spent the model key would pass on the status alone.
 */
function build(overrides = {}) {
  const handled = [];
  const validated = [];

  const handler = createProxyHandler({
    logPrefix: '[test]',
    route: ROUTE,
    secret: SECRET,
    origins: ORIGINS,
    maxBodyBytes: MAX_BODY,
    nowSeconds: () => NOW,
    unavailable: 'Downstream is unavailable.',
    validate: (body) => {
      validated.push(body);
      if (typeof body !== 'object' || body === null || typeof body.wanted !== 'string') {
        return { error: 'wanted must be a string.' };
      }
      return { wanted: body.wanted };
    },
    handle: async (request) => {
      handled.push(request);
      return { echoed: request.wanted };
    },
    ...overrides,
  });

  return { handler, handled, validated };
}

/**
 * An API Gateway v2 (HTTP API) event, which is what `aws_apigatewayv2_api` sends.
 *
 * Authorized and on-route by default, so each test names only the one thing it is
 * changing — an event literal per case buries the difference under fifteen identical
 * lines.
 */
function event({
  method = 'POST',
  path = ROUTE,
  origin = ALLOWED,
  token = TOKEN,
  body = JSON.stringify({ wanted: 'a capybara' }),
  isBase64Encoded,
  headers,
} = {}) {
  const built = {};
  if (origin !== null) {
    built.origin = origin;
  }
  if (token !== null) {
    built.authorization = `Bearer ${token}`;
  }
  return {
    requestContext: { http: { method, path } },
    headers: headers ?? built,
    body,
    ...(isBase64Encoded === undefined ? {} : { isBase64Encoded }),
  };
}

const parse = (result) => JSON.parse(result.body);

describe('the happy path', () => {
  it('validates, calls the downstream and answers 200 with its result', async () => {
    const { handler, handled, validated } = build();
    const result = await handler(event());

    assert.equal(result.statusCode, 200);
    assert.deepEqual(parse(result), { echoed: 'a capybara' });
    assert.deepEqual(validated, [{ wanted: 'a capybara' }]);
    assert.deepEqual(handled, [{ wanted: 'a capybara' }]);
  });

  it('answers JSON and forbids caching, so a proxy cannot replay a recognition', async () => {
    const { handler } = build();
    const result = await handler(event());
    assert.equal(result.headers['Content-Type'], 'application/json');
    assert.equal(result.headers['Cache-Control'], 'no-store');
  });

  it('reads a base64 body, which is how a binary-ish frame arrives', async () => {
    const { handler, handled } = build();
    const json = JSON.stringify({ wanted: 'a capybara' });
    const result = await handler(
      event({ body: Buffer.from(json, 'utf8').toString('base64'), isBase64Encoded: true })
    );

    assert.equal(result.statusCode, 200);
    assert.deepEqual(handled, [{ wanted: 'a capybara' }]);
  });

  it('accepts a v1 (REST) event, whose method and path live in different fields', async () => {
    const { handler, handled } = build();
    const result = await handler({
      httpMethod: 'POST',
      path: ROUTE,
      headers: { Origin: ALLOWED, Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ wanted: 'a capybara' }),
    });

    assert.equal(result.statusCode, 200);
    assert.equal(handled.length, 1);
  });

  it('reads Authorization and Origin whatever their casing', async () => {
    // v2 lowercases header names, v1 passes them through as sent. A boundary that only
    // reads one casing is one a caller can skip by changing a letter.
    const { handler, handled } = build();
    for (const headers of [
      { authorization: `Bearer ${TOKEN}`, origin: ALLOWED },
      { Authorization: `Bearer ${TOKEN}`, Origin: ALLOWED },
      { AUTHORIZATION: `Bearer ${TOKEN}`, ORIGIN: ALLOWED },
    ]) {
      const result = await handler(event({ headers }));
      assert.equal(result.statusCode, 200, JSON.stringify(headers));
    }
    assert.equal(handled.length, 3);
  });
});

describe('the preflight', () => {
  it('answers 204 with the CORS headers and no body, before asking for a token', async () => {
    // A browser never sends `Authorization` on a preflight, so requiring one here would
    // refuse the request that tells the browser it may send one.
    const { handler, handled } = build();
    const result = await handler(event({ method: 'OPTIONS', token: null, body: null }));

    assert.equal(result.statusCode, 204);
    assert.equal(result.body, '');
    assert.equal(result.headers['Access-Control-Allow-Origin'], ALLOWED);
    assert.equal(result.headers['Access-Control-Allow-Methods'], ALLOWED_METHODS);
    assert.match(result.headers['Access-Control-Allow-Headers'], /Authorization/);
    assert.deepEqual(handled, []);
  });

  it('omits the allow header on a preflight from an unlisted origin', async () => {
    const { handler } = build();
    const result = await handler(event({ method: 'OPTIONS', origin: 'https://evil.example.com', token: null }));

    assert.equal(result.statusCode, 204);
    assert.equal('Access-Control-Allow-Origin' in result.headers, false);
  });
});

describe('the origin allow-list', () => {
  it('refuses an unlisted origin outright, before authorizing or handling', async () => {
    // Outright, not merely without an allow header: HTTP API replaces the headers a
    // Lambda returns with its own `cors_configuration`, so on AWS a header-only defence
    // is no defence — the hop would have been taken and the model billed.
    const { handler, handled, validated } = build();
    const result = await handler(event({ origin: 'https://evil.example.com' }));

    assert.equal(result.statusCode, 403);
    assert.equal(parse(result).error, 'Origin is not allowed.');
    assert.deepEqual(handled, []);
    assert.deepEqual(validated, []);
  });

  it('refuses Origin: null rather than treating it as absent', async () => {
    const { handler, handled } = build();
    const result = await handler(event({ origin: 'null' }));
    assert.equal(result.statusCode, 403);
    assert.deepEqual(handled, []);
  });

  it('admits a request with no Origin at all, which still has to present a token', async () => {
    // `curl`, `smoke.mjs` and any server-to-server caller send none. CORS is a browser
    // mechanism; the token is what bounds these.
    const { handler, handled } = build();
    assert.equal((await handler(event({ origin: null }))).statusCode, 200);
    assert.equal((await handler(event({ origin: null, token: null }))).statusCode, 401);
    assert.equal(handled.length, 1);
  });

  it('never answers a wildcard allow-origin, for any input', async () => {
    const { handler } = build();
    for (const origin of [ALLOWED, 'https://evil.example.com', null, 'null', '*']) {
      const result = await handler(event({ origin }));
      assert.notEqual(result.headers['Access-Control-Allow-Origin'], '*', String(origin));
    }
  });
});

describe('the route and the method', () => {
  it('answers 404 for a path that is not this service, without authorizing it', async () => {
    // Only reachable via a `$default`/`{proxy+}` integration pointed here by mistake —
    // which is exactly the misconfiguration worth failing loudly.
    const { handler, handled } = build();
    const result = await handler(event({ path: '/somewhere/else' }));

    assert.equal(result.statusCode, 404);
    assert.equal(parse(result).error, `POST ${ROUTE}`);
    assert.deepEqual(handled, []);
  });

  it('serves the route with a query string and a stage prefix on it', async () => {
    const { handler } = build();
    assert.equal((await handler(event({ path: `${ROUTE}?trace=1` }))).statusCode, 200);
    assert.equal((await handler(event({ path: `/prod${ROUTE}` }))).statusCode, 200);
  });

  it('answers 405 for every method but POST and OPTIONS', async () => {
    const { handler, handled } = build();
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE', 'HEAD']) {
      const result = await handler(event({ method }));
      assert.equal(result.statusCode, 405, method);
      assert.equal(parse(result).error, 'Use POST.', method);
    }
    assert.deepEqual(handled, []);
  });

  it('serves an event that names no method at all, as a direct invoke does', async () => {
    const { handler } = build();
    const result = await handler({
      headers: { authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ wanted: 'a capybara' }),
    });
    assert.equal(result.statusCode, 200);
  });
});

describe('authorization', () => {
  it('answers 401 for every unauthenticated case, without validating or handling', async () => {
    const cases = {
      'no header': { token: null },
      'presence only — the check this replaces': { headers: { authorization: 'Bearer x', origin: ALLOWED } },
      'not a bearer scheme': { headers: { authorization: 'Basic abc', origin: ALLOWED } },
      'not a JWT': { token: 'nonsense' },
      'wrong secret': { token: mint({}, { secret: 'other' }) },
      expired: { token: mint({ exp: NOW - 1 }) },
      'alg none': { token: `${mint().split('.').slice(0, 2).join('.')}.` },
      'no tenant': { token: mint({ tenantId: '' }) },
    };

    for (const [label, overrides] of Object.entries(cases)) {
      const { handler, handled, validated } = build();
      const result = await handler(event(overrides));

      assert.equal(result.statusCode, 401, label);
      // One body for all of them: distinguishing "expired" from "forged" is a probing
      // oracle, and the till's recovery is the same either way.
      assert.equal(parse(result).error, 'Authorization required.', label);
      assert.deepEqual(handled, [], label);
      assert.deepEqual(validated, [], label);
    }
  });

  it('answers 403 naming the missing permission when the caller is authenticated', async () => {
    const { handler, handled } = build();
    const readOnly = mint({ roles: ['viewer'], permissions: ['inventory:view'] });
    const result = await handler(event({ token: readOnly }));

    assert.equal(result.statusCode, 403);
    assert.equal(parse(result).error, 'Requires sale:process.');
    assert.deepEqual(handled, []);
  });

  it('answers 503, never 401, when the secret vanished under a running function', async () => {
    // `readProxyEnvironment` makes this unreachable on a cold start; a warm function
    // whose configuration changed is the case that is left, and "this service is broken"
    // is the true answer rather than "your token is bad".
    const { handler, handled } = build({ secret: '' });
    const result = await handler(event());

    assert.equal(result.statusCode, 503);
    assert.equal(parse(result).error, 'Auth is not configured.');
    assert.deepEqual(handled, []);
  });
});

describe('the body', () => {
  it('answers 413 above the cap, after authorizing and before parsing', async () => {
    const { handler, handled, validated } = build();
    const result = await handler(event({ body: JSON.stringify({ wanted: 'x'.repeat(MAX_BODY) }) }));

    assert.equal(result.statusCode, 413);
    assert.equal(parse(result).error, 'Request body too large.');
    assert.deepEqual(validated, [], 'an over-cap body was parsed and validated anyway');
    assert.deepEqual(handled, []);
  });

  it('caps on bytes, not characters, so multi-byte text cannot slip past', async () => {
    // `'🐹'.length` is 2 and its UTF-8 encoding is 4 bytes. A cap read off `.length`
    // would admit twice the intended payload.
    const { handler } = build({ maxBodyBytes: 40 });
    const wanted = '🐹'.repeat(12); // 48 bytes of content, 24 UTF-16 units
    assert.equal((await handler(event({ body: JSON.stringify({ wanted }) }))).statusCode, 413);
  });

  it('refuses a body that is not JSON, and one that is not the base64 it claims', async () => {
    const { handler, handled } = build();
    for (const overrides of [
      { body: 'not json' },
      { body: '' },
      { body: null },
      { body: '{"wanted":', isBase64Encoded: false },
      { body: 'not base64 at all!!', isBase64Encoded: true },
    ]) {
      const result = await handler(event(overrides));
      assert.equal(result.statusCode, 400, JSON.stringify(overrides));
      assert.equal(parse(result).error, 'Body must be JSON.', JSON.stringify(overrides));
    }
    assert.deepEqual(handled, []);
  });

  it("passes the validator's refusal through, and does not call the downstream", async () => {
    const { handler, handled, validated } = build();
    const result = await handler(event({ body: JSON.stringify({ wanted: 42 }) }));

    assert.equal(result.statusCode, 400);
    assert.equal(parse(result).error, 'wanted must be a string.');
    assert.deepEqual(validated, [{ wanted: 42 }]);
    assert.deepEqual(handled, []);
  });
});

describe('a failing downstream', () => {
  it('answers 502 with nothing about why, and keeps the reason in the log', async () => {
    const logged = [];
    const error = console.error;
    console.error = (...args) => logged.push(args);
    try {
      const { handler } = build({
        handle: async () => {
          throw new Error('sk-ant-secret-in-the-message');
        },
      });
      const result = await handler(event());

      assert.equal(result.statusCode, 502);
      assert.deepEqual(parse(result), { error: 'Downstream is unavailable.' });
      assert.doesNotMatch(result.body, /sk-ant/, 'the model error reached the caller');
    } finally {
      console.error = error;
    }

    // The operator id is what makes a 502 traceable to a session.
    assert.equal(logged.length, 1);
    assert.equal(logged[0][1].operatorId, 'op-1');
  });

  it('still answers with the CORS headers, so the till can read the 502', async () => {
    const { handler } = build({
      handle: async () => {
        throw new Error('nope');
      },
    });
    const result = await handler(event());
    assert.equal(result.headers['Access-Control-Allow-Origin'], ALLOWED);
  });
});

describe('readProxyEnvironment', () => {
  const base = { SESSION_JWT_SECRET: SECRET, ALLOWED_ORIGINS: `${ALLOWED},http://localhost:4200` };

  it('returns the secret and the parsed origin list', () => {
    assert.deepEqual(readProxyEnvironment(base, '[test]'), { secret: SECRET, origins: ORIGINS });
  });

  it('parses the origin list with the guard, trailing slashes and duplicates included', () => {
    const { origins } = readProxyEnvironment({ ...base, ALLOWED_ORIGINS: ` ${ALLOWED}/ ,${ALLOWED}` }, '[test]');
    assert.deepEqual(origins, [ALLOWED]);
  });

  it('throws for a missing secret, naming the variable and where it comes from', () => {
    // A throw at module scope fails the function's init, which is the Lambda equivalent
    // of `server.ts` refusing to listen. Answering 503 on every call instead would turn
    // a forgotten variable into an outage somebody pages about.
    for (const SESSION_JWT_SECRET of [undefined, '']) {
      assert.throws(() => readProxyEnvironment({ ...base, SESSION_JWT_SECRET }, '[test]'), {
        message: /\[test\] SESSION_JWT_SECRET is not set.*session-issuer\.ts/s,
      });
    }
  });

  it('throws for an unusable origin list rather than answering every origin', () => {
    for (const ALLOWED_ORIGINS of [undefined, '', '   ', ',', ' , , ']) {
      assert.throws(() => readProxyEnvironment({ ...base, ALLOWED_ORIGINS }, '[test]'), {
        message: /\[test\] ALLOWED_ORIGINS is not set/,
      });
    }
  });

  it('checks the secret before the origins, so the first missing variable is named', () => {
    assert.throws(() => readProxyEnvironment({}, '[test]'), { message: /SESSION_JWT_SECRET/ });
  });
});

describe('the order of the checks matches the socket boundary', () => {
  const HERE = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(HERE, 'proxy-handler.ts'), 'utf8');
  const socket = readFileSync(join(HERE, 'http.ts'), 'utf8');

  /**
   * From the factory onward, so the `BoundaryConfig` declarations above it — which name
   * the same fields in a different order — cannot answer for the checks.
   */
  const body = (text) => text.slice(text.search(/^export function create/m));

  /**
   * The behavioural tests above pin each status. What they cannot see is that the two
   * boundaries stay the same boundary: `http.ts` reads a socket and this reads an
   * event, so nothing forces them to agree, and a check added to one and not the other
   * is a service that is safe over one transport and not the other.
   */
  it('is the same sequence of gates, in the same order, in both files', () => {
    const gates = [/OPTIONS/, /originAllowed\(/, /authorize\(/, /config\.maxBodyBytes/, /JSON\.parse\(/, /config\.validate\(/, /config\.handle\(/];
    for (const [name, text] of [
      ['proxy-handler.ts', body(source)],
      ['http.ts', body(socket)],
    ]) {
      let previous = -1;
      for (const gate of gates) {
        const at = text.search(gate);
        assert.ok(at > previous, `${name}: ${gate} does not come after the gate before it`);
        previous = at;
      }
    }
  });

  it('authorizes before it looks at the body at all', () => {
    const authorizeAt = source.search(/authorize\(readHeader/);
    assert.ok(authorizeAt > 0, 'proxy-handler.ts does not call authorize() on the event headers');
    for (const later of [/decodeBody\(event\)/, /Buffer\.byteLength/, /JSON\.parse\(raw\)/]) {
      assert.ok(source.search(later) > authorizeAt, `proxy-handler.ts reaches ${later} before authorizing`);
    }
  });

  it('requires the sell permission, not merely a valid token', () => {
    assert.match(source, /Permission\.PROCESS_SALE/);
  });

  it('never writes a wildcard allow-origin', () => {
    assert.doesNotMatch(source, /Access-Control-Allow-Origin["']?\s*:\s*["']\*/);
  });
});

// Made with Bob
