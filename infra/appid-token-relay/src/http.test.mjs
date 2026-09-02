/**
 * The suite for the transport boundary — over a real socket.
 *
 * Same reasoning and the same shape as `infra/clerk-agent-relay/src/http.test.mjs`:
 * a boundary asserted by grepping the source proves a string is present, not that
 * a request is refused, so every case here starts a real `http.Server` and sends
 * a real request at it, asserting `handle` was reached or not reached alongside
 * the status code. The one structural difference this suite reflects is the one
 * `http.ts`'s own doc comment names: there is no `authorize()` step, so there is
 * no auth describe block here — and `handle`'s result is passed through as its
 * own status+body rather than folded into a fixed 200.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { ALLOWED_METHODS, createRequestListener } from './http.ts';

const ALLOWED = 'https://till.example.com';
const ORIGINS = [ALLOWED, 'http://localhost:4200'];
const ROUTE = '/appid/token';
const MAX_BODY = 2048;

async function withServer(overrides, run) {
  const handled = [];
  const validated = [];

  const listener = createRequestListener({
    logPrefix: '[test]',
    route: ROUTE,
    origins: ORIGINS,
    maxBodyBytes: MAX_BODY,
    unavailable: 'The sign-in service is unavailable.',
    validate: (body) => {
      validated.push(body);
      if (typeof body !== 'object' || body === null || typeof body.grant_type !== 'string') {
        return { error: 'grant_type is required.' };
      }
      return { grantType: body.grant_type };
    },
    handle: async (request) => {
      handled.push(request);
      return { status: 200, body: { access_token: `token-for-${request.grantType}` } };
    },
    ...overrides,
  });

  const server = createServer(listener);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    return await run({ port, handled, validated });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function send(port, { method = 'POST', path = ROUTE, headers = {}, body, chunks } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const received = [];
      res.on('data', (chunk) => received.push(chunk));
      res.on('end', () => {
        settled = true;
        const text = Buffer.concat(received).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });

    req.on('error', (error) => {
      if (!settled) {
        reject(error);
      }
    });

    if (chunks) {
      for (const chunk of chunks) {
        if (!req.writableEnded && !req.destroyed) {
          req.write(chunk, () => {});
        }
      }
    } else if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

const post = (port, { headers, ...rest } = {}) =>
  send(port, {
    headers: { Origin: ALLOWED, 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ grant_type: 'password', username: 'u', password: 'p' }),
    ...rest,
  });

describe('the boundary, over a socket', () => {
  it('serves a request on the configured route with no credential at all', async () => {
    // The defining difference from the sibling proxies: this is the whole point.
    await withServer({}, async ({ port, handled }) => {
      const response = await post(port);
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, { access_token: 'token-for-password' });
      assert.deepEqual(handled, [{ grantType: 'password' }]);
    });
  });

  it('serves the route with a query string on it', async () => {
    await withServer({}, async ({ port }) => {
      assert.equal((await post(port, { path: `${ROUTE}?trace=abc` })).status, 200);
    });
  });

  it('serves a caller that sends no Origin at all, e.g. curl or smoke.mjs', async () => {
    await withServer({}, async ({ port, handled }) => {
      const response = await send(port, {
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ grant_type: 'password', username: 'u', password: 'p' }),
      });
      assert.equal(response.status, 200);
      assert.equal(handled.length, 1);
    });
  });
});

describe('CORS, over a socket', () => {
  it('answers a preflight and echoes the one allowed origin', async () => {
    await withServer({}, async ({ port, handled }) => {
      const response = await send(port, { method: 'OPTIONS', headers: { Origin: ALLOWED } });
      assert.equal(response.status, 204);
      assert.equal(response.headers['access-control-allow-origin'], ALLOWED);
      assert.equal(response.headers['access-control-allow-methods'], ALLOWED_METHODS);
      assert.equal(response.headers['vary'], 'Origin');
      assert.deepEqual(handled, []);
    });
  });

  it('never answers Access-Control-Allow-Origin: * — on any status', async () => {
    await withServer({}, async ({ port }) => {
      const responses = [
        await send(port, { method: 'OPTIONS', headers: { Origin: ALLOWED } }),
        await send(port, { method: 'OPTIONS', headers: { Origin: 'https://evil.example.com' } }),
        await post(port),
        await post(port, { headers: { Origin: 'https://evil.example.com' } }),
        await post(port, { path: '/nope' }),
        await post(port, { body: 'not json' }),
      ];
      for (const response of responses) {
        assert.notEqual(response.headers['access-control-allow-origin'], '*', `status ${response.status} sent a wildcard`);
      }
    });
  });

  it('refuses a present-but-unlisted origin outright, before spending an attempt against App ID', async () => {
    await withServer({}, async ({ port, handled, validated }) => {
      const response = await post(port, { headers: { Origin: 'https://evil.example.com' } });
      assert.equal(response.status, 403);
      assert.deepEqual(response.json, { error: 'Origin is not allowed.' });
      assert.equal(response.headers['access-control-allow-origin'], undefined);
      assert.deepEqual(handled, []);
      assert.deepEqual(validated, []);
    });
  });

  it('refuses Origin: null, which a sandboxed iframe or a file:// page sends', async () => {
    await withServer({}, async ({ port, handled }) => {
      assert.equal((await post(port, { headers: { Origin: 'null' } })).status, 403);
      assert.deepEqual(handled, []);
    });
  });
});

describe('routing, over a socket', () => {
  it('404s another path', async () => {
    await withServer({}, async ({ port, handled }) => {
      const response = await post(port, { path: '/nope' });
      assert.equal(response.status, 404);
      assert.deepEqual(response.json, { error: `POST ${ROUTE}` });
      assert.deepEqual(handled, []);
    });
  });

  for (const method of ['GET', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
    it(`404s ${method} on the route`, async () => {
      await withServer({}, async ({ port, handled }) => {
        const response = await send(port, { method, path: ROUTE, headers: { Origin: ALLOWED } });
        assert.equal(response.status, 404);
        assert.deepEqual(handled, []);
      });
    });
  }
});

describe('the body cap, over a socket', () => {
  it('413s a body over the cap without buffering it or calling App ID', async () => {
    await withServer({}, async ({ port, handled, validated }) => {
      const chunk = 'x'.repeat(512);
      const response = await send(port, {
        headers: { Origin: ALLOWED, 'Content-Type': 'application/json' },
        chunks: Array.from({ length: 40 }, () => chunk),
      });
      assert.equal(response.status, 413);
      assert.deepEqual(response.json, { error: 'Request body too large.' });
      assert.deepEqual(handled, []);
      assert.deepEqual(validated, []);
    });
  });

  it('serves a body that fits, so the cap is a ceiling and not a coin flip', async () => {
    await withServer({}, async ({ port, handled }) => {
      const body = JSON.stringify({ grant_type: 'password', username: 'u'.repeat(MAX_BODY - 128), password: 'p' });
      assert.ok(body.length <= MAX_BODY, 'fixture must fit under the cap');
      const response = await send(port, {
        headers: { Origin: ALLOWED, 'Content-Type': 'application/json' },
        body,
      });
      assert.equal(response.status, 200);
      assert.equal(handled.length, 1);
    });
  });
});

describe('the body itself, over a socket', () => {
  it('400s a body that is not JSON', async () => {
    await withServer({}, async ({ port, handled }) => {
      const response = await post(port, { body: 'not json at all' });
      assert.equal(response.status, 400);
      assert.deepEqual(response.json, { error: 'Body must be JSON.' });
      assert.deepEqual(handled, []);
    });
  });

  it("400s with the validator's own message, and does not call App ID", async () => {
    await withServer({}, async ({ port, handled, validated }) => {
      const response = await post(port, { body: JSON.stringify({ grant_type: 42 }) });
      assert.equal(response.status, 400);
      assert.deepEqual(response.json, { error: 'grant_type is required.' });
      assert.deepEqual(validated, [{ grant_type: 42 }]);
      assert.deepEqual(handled, []);
    });
  });
});

describe('handle result pass-through, over a socket', () => {
  it('answers whatever status+body handle resolved with, not a fixed 200', async () => {
    // This is the load-bearing difference from the sibling proxies' boundary:
    // AppIdAuthAdapter reads a 400 { error: 'invalid_grant' } body directly, so the
    // boundary must not fold a well-formed OAuth error into a success shape.
    await withServer(
      {
        handle: async () => ({ status: 400, body: { error: 'invalid_grant', error_description: 'nope' } }),
      },
      async ({ port }) => {
        const response = await post(port);
        assert.equal(response.status, 400);
        assert.deepEqual(response.json, { error: 'invalid_grant', error_description: 'nope' });
      }
    );
  });

  it('502s a genuine transport failure (handle throwing) without leaking the reason', async () => {
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
      await withServer(
        {
          handle: async () => {
            throw new Error('APPID_CLIENT_SECRET=super-secret-value rejected by upstream host');
          },
        },
        async ({ port }) => {
          const response = await post(port);
          assert.equal(response.status, 502);
          assert.deepEqual(response.json, { error: 'The sign-in service is unavailable.' });
          assert.doesNotMatch(response.text, /super-secret-value/, 'the 502 body leaked the client secret');
        }
      );
    } finally {
      console.error = original;
    }
    assert.equal(errors.length, 1);
  });
});
