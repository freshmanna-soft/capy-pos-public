/**
 * The suite for the route table — the pure matching, and the dispatch over a socket.
 *
 * Written first, against the bug it exists to stop: before this table,
 * `server.ts` dispatched prefix-match-else-*default*, so anything that was not
 * an admin path and not `/appid/forgot-password` fell through to the token
 * listener, and only 404'd because that listener happened to re-check the path
 * itself. Two checks accidentally agreeing is not a route table — the moment a
 * fourth route was added the same way, the default arm would have answered it.
 * So the cases that matter most here are the negative ones: an unknown path
 * reaches *no* listener at all, and gets this boundary's own 404.
 *
 * Same shape as `http.test.mjs` for the socket half (a boundary asserted by
 * grepping the source proves a string is present, not that a request is
 * refused), with stub listeners recording which one was reached.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { allowedMethods, createRouter, describeRoutes, matchRoute, requestPath, routeLabel } from './routes.ts';

const ALLOWED = 'https://till.example.com';
const ORIGINS = [ALLOWED, 'http://localhost:4200'];

const TOKEN_ROUTE = '/appid/token';
const FORGOT_PASSWORD_ROUTE = '/appid/forgot-password';
const ADMIN_ROUTE_PREFIX = '/appid/admin/';

/** The real table's shape, with listeners that only record that they were reached. */
function table(reached) {
  return [
    {
      match: 'exact',
      path: TOKEN_ROUTE,
      methods: 'POST, OPTIONS',
      listener: (req, res) => {
        reached.push(['token', req.method, req.url]);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"reached":"token"}');
      },
    },
    {
      match: 'exact',
      path: FORGOT_PASSWORD_ROUTE,
      methods: 'POST, OPTIONS',
      listener: (req, res) => {
        reached.push(['forgot-password', req.method, req.url]);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"reached":"forgot-password"}');
      },
    },
    {
      match: 'prefix',
      path: ADMIN_ROUTE_PREFIX,
      methods: 'GET, POST, PUT, DELETE, OPTIONS',
      listener: (req, res) => {
        reached.push(['admin', req.method, req.url]);
        res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"reached":"admin"}');
      },
    },
  ];
}

describe('requestPath', () => {
  it('drops the query string, which is never part of a route', () => {
    assert.equal(requestPath(`${TOKEN_ROUTE}?trace=abc`), TOKEN_ROUTE);
    assert.equal(requestPath(TOKEN_ROUTE), TOKEN_ROUTE);
  });

  it('answers the empty string for a request with no url, rather than throwing', () => {
    assert.equal(requestPath(undefined), '');
    assert.equal(requestPath(''), '');
  });
});

describe('matchRoute', () => {
  const routes = table([]);

  it('matches an exact route', () => {
    assert.equal(matchRoute(routes, TOKEN_ROUTE)?.path, TOKEN_ROUTE);
    assert.equal(matchRoute(routes, FORGOT_PASSWORD_ROUTE)?.path, FORGOT_PASSWORD_ROUTE);
  });

  it('matches a prefix route on any path under it', () => {
    for (const path of ['/appid/admin/staff', '/appid/admin/roles', '/appid/admin/staff/abc-123/role']) {
      assert.equal(matchRoute(routes, path)?.path, ADMIN_ROUTE_PREFIX, path);
    }
  });

  it('claims nothing for a path no entry declares — the old default arm', () => {
    for (const path of ['', '/', '/nope', '/appid', '/appid/', '/appid/admin', '/appid/tokens']) {
      assert.equal(matchRoute(routes, path), null, path);
    }
  });

  it('claims nothing for a path that merely ends with a route — the bug this table replaces', () => {
    // The old dispatch sent this to the token listener, which matched its own
    // route with `endsWith` and served it.
    for (const path of ['/anything/appid/token', '//appid/token', '/x/appid/forgot-password']) {
      assert.equal(matchRoute(routes, path), null, path);
    }
  });

  it('refuses to treat a trailing slash as the same route', () => {
    assert.equal(matchRoute(routes, `${TOKEN_ROUTE}/`), null);
  });

  it('is order-independent: an exact route wins over a prefix that also covers it', () => {
    const overlapping = [
      { match: 'prefix', path: '/appid/', methods: 'POST, OPTIONS', listener: () => {} },
      { match: 'exact', path: TOKEN_ROUTE, methods: 'POST, OPTIONS', listener: () => {} },
    ];
    assert.equal(matchRoute(overlapping, TOKEN_ROUTE)?.match, 'exact');
    assert.equal(matchRoute([...overlapping].reverse(), TOKEN_ROUTE)?.match, 'exact');
  });
});

describe('allowedMethods', () => {
  it('unions the methods every route declares, with OPTIONS last', () => {
    assert.equal(allowedMethods(table([])), 'POST, GET, PUT, DELETE, OPTIONS');
  });

  it('always advertises OPTIONS, even for a table that forgot to', () => {
    assert.equal(allowedMethods([{ match: 'exact', path: '/x', methods: 'POST', listener: () => {} }]), 'POST, OPTIONS');
  });
});

describe('routeLabel / describeRoutes', () => {
  it('marks a prefix route with a star and leaves an exact one alone', () => {
    const [token, , admin] = table([]);
    assert.equal(routeLabel(token), TOKEN_ROUTE);
    assert.equal(routeLabel(admin), `${ADMIN_ROUTE_PREFIX}*`);
  });

  it('reads as the 404 body: the routes this service actually serves', () => {
    assert.equal(
      describeRoutes(table([])),
      `${TOKEN_ROUTE}, ${FORGOT_PASSWORD_ROUTE}, or ${ADMIN_ROUTE_PREFIX}*`
    );
  });
});

// ─── Over a socket ─────────────────────────────────────────────────────────────

async function withRouter(run) {
  const reached = [];
  const server = createServer(createRouter({ routes: table(reached), origins: ORIGINS }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    return await run({ port, reached });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function send(port, { method = 'POST', path = TOKEN_ROUTE, headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port, method, path, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json;
        try {
          json = JSON.parse(text);
        } catch {
          json = undefined;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    req.end();
  });
}

describe('dispatch, over a socket', () => {
  it('hands each declared route to its own listener', async () => {
    await withRouter(async ({ port, reached }) => {
      assert.deepEqual((await send(port, { path: TOKEN_ROUTE, headers: { Origin: ALLOWED } })).json, {
        reached: 'token',
      });
      assert.deepEqual((await send(port, { path: FORGOT_PASSWORD_ROUTE, headers: { Origin: ALLOWED } })).json, {
        reached: 'forgot-password',
      });
      assert.deepEqual(
        (await send(port, { method: 'GET', path: '/appid/admin/staff', headers: { Origin: ALLOWED } })).json,
        { reached: 'admin' }
      );
      assert.deepEqual(reached.map(([name]) => name), ['token', 'forgot-password', 'admin']);
    });
  });

  it('dispatches on the path only, ignoring a query string', async () => {
    await withRouter(async ({ port, reached }) => {
      await send(port, { path: `${TOKEN_ROUTE}?trace=abc`, headers: { Origin: ALLOWED } });
      assert.deepEqual(reached.map(([name]) => name), ['token']);
    });
  });

  it('leaves a matched route to answer its own preflight, with its own methods', async () => {
    // Each boundary advertises what *it* serves (`POST, OPTIONS` for the token
    // route, four verbs for admin) — the router must not flatten that into one
    // answer for every path.
    await withRouter(async ({ port, reached }) => {
      await send(port, { method: 'OPTIONS', path: TOKEN_ROUTE, headers: { Origin: ALLOWED } });
      assert.deepEqual(reached, [['token', 'OPTIONS', TOKEN_ROUTE]]);
    });
  });
});

describe('the 404, over a socket', () => {
  it('answers an unknown path itself, reaching no listener at all', async () => {
    await withRouter(async ({ port, reached }) => {
      for (const path of ['/nope', '/appid', '/appid/admin', '/appid/token/extra']) {
        const response = await send(port, { path, headers: { Origin: ALLOWED } });
        assert.equal(response.status, 404, path);
        assert.deepEqual(response.json, {
          error: `${TOKEN_ROUTE}, ${FORGOT_PASSWORD_ROUTE}, or ${ADMIN_ROUTE_PREFIX}*`,
        });
      }
      assert.deepEqual(reached, []);
    });
  });

  it('404s a path that merely ends with a real route — the regression this replaces', async () => {
    await withRouter(async ({ port, reached }) => {
      assert.equal((await send(port, { path: '/anything/appid/token', headers: { Origin: ALLOWED } })).status, 404);
      assert.deepEqual(reached, []);
    });
  });

  it('404s every method on an unknown path, not just POST', async () => {
    await withRouter(async ({ port, reached }) => {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
        assert.equal((await send(port, { method, path: '/nope', headers: { Origin: ALLOWED } })).status, 404, method);
      }
      assert.deepEqual(reached, []);
    });
  });

  it('carries the CORS headers, so the browser can read the 404 instead of reporting a CORS failure', async () => {
    await withRouter(async ({ port }) => {
      const response = await send(port, { path: '/nope', headers: { Origin: ALLOWED } });
      assert.equal(response.headers['access-control-allow-origin'], ALLOWED);
      assert.equal(response.headers['vary'], 'Origin');
      assert.equal(response.headers['access-control-allow-methods'], 'POST, GET, PUT, DELETE, OPTIONS');
    });
  });
});

describe('CORS on an unrouted path, over a socket', () => {
  it('refuses an unlisted origin before the route match, exactly as every route does', async () => {
    // Origin before route (`http.ts`'s documented order) — the answer must not
    // depend on whether the path happened to be a real one.
    await withRouter(async ({ port, reached }) => {
      const response = await send(port, { path: '/nope', headers: { Origin: 'https://evil.example.com' } });
      assert.equal(response.status, 403);
      assert.deepEqual(response.json, { error: 'Origin is not allowed.' });
      assert.equal(response.headers['access-control-allow-origin'], undefined);
      assert.deepEqual(reached, []);
    });
  });

  it('answers a preflight on an unknown path 204, the way the default arm used to', async () => {
    await withRouter(async ({ port, reached }) => {
      const response = await send(port, { method: 'OPTIONS', path: '/nope', headers: { Origin: ALLOWED } });
      assert.equal(response.status, 204);
      assert.equal(response.headers['access-control-allow-origin'], ALLOWED);
      assert.deepEqual(reached, []);
    });
  });

  it('serves a caller that sends no Origin at all, e.g. curl or smoke.mjs', async () => {
    await withRouter(async ({ port, reached }) => {
      assert.equal((await send(port, { path: TOKEN_ROUTE })).status, 200);
      assert.equal((await send(port, { path: '/nope' })).status, 404);
      assert.deepEqual(reached.map(([name]) => name), ['token']);
    });
  });

  it('never answers Access-Control-Allow-Origin: * — on any status', async () => {
    await withRouter(async ({ port }) => {
      const responses = [
        await send(port, { path: TOKEN_ROUTE, headers: { Origin: ALLOWED } }),
        await send(port, { path: '/nope', headers: { Origin: ALLOWED } }),
        await send(port, { path: '/nope', headers: { Origin: 'https://evil.example.com' } }),
        await send(port, { method: 'OPTIONS', path: '/nope', headers: { Origin: ALLOWED } }),
        await send(port, { method: 'OPTIONS', path: '/nope', headers: { Origin: 'https://evil.example.com' } }),
      ];
      for (const response of responses) {
        assert.notEqual(
          response.headers['access-control-allow-origin'],
          '*',
          `status ${response.status} sent a wildcard`
        );
      }
    });
  });
});
