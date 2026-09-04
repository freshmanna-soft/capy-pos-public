/**
 * The suite for the admin staff-management boundary — over a real socket, same
 * reasoning as `http.test.mjs`: every case starts a real `http.Server` and sends
 * a real request, asserting the right config callback was (or was not) reached
 * alongside the status code.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createHmac } from 'node:crypto';
import { ALLOWED_METHODS, createAdminRequestListener } from './admin-http.ts';

const ALLOWED = 'https://till.example.com';
const ORIGINS = [ALLOWED];
const MAX_BODY = 2048;
const SECRET = 'capy-pos-local-jwt-secret-change-in-production';
const NOW = 1_800_000_000;

function mint(payload = {}) {
  const claims = { sub: 'op-1', permissions: ['admin:manage_operators'], iat: NOW - 60, exp: NOW + 3600, ...payload };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  const signature = createHmac('sha256', SECRET).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

const ADMIN_TOKEN = () => mint();
const bearer = (token) => `Bearer ${token}`;

async function withServer(overrides, run) {
  const calls = { list: [], listRoles: [], create: [], reassignRole: [], revoke: [] };

  const listener = createAdminRequestListener({
    logPrefix: '[test]',
    auth: { secret: SECRET },
    origins: ORIGINS,
    maxBodyBytes: MAX_BODY,
    unavailable: 'The staff-management service is unavailable.',
    nowSeconds: () => NOW,
    validateCreate: (body) => {
      if (typeof body?.email !== 'string' || typeof body?.roleId !== 'string') {
        return { error: 'email and roleId are required.' };
      }
      return { email: body.email, roleId: body.roleId };
    },
    validateAssignRole: (body) => {
      if (typeof body?.roleId !== 'string') {
        return { error: 'roleId is required.' };
      }
      return { roleId: body.roleId };
    },
    listRoles: async () => {
      calls.listRoles.push(true);
      return [{ id: 'role-admin', name: 'admin' }];
    },
    list: async () => {
      calls.list.push(true);
      return [{ id: 'u1', email: 'a@capy.test', displayName: 'A', roleId: 'role-admin', roleName: 'admin' }];
    },
    create: async (request) => {
      calls.create.push(request);
      return { id: 'new-1', email: request.email, displayName: request.email };
    },
    reassignRole: async (userId, request) => {
      calls.reassignRole.push({ userId, request });
      return undefined;
    },
    revoke: async (userId) => {
      calls.revoke.push(userId);
    },
    ...overrides,
  });

  const server = createServer(listener);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();

  try {
    return await run({ port, calls });
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

function send(port, { method = 'GET', path = '/appid/admin/staff', headers = {}, body, chunks } = {}) {
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
      if (!settled) reject(error);
    });
    if (chunks) {
      for (const chunk of chunks) req.write(chunk, () => {});
    } else if (body !== undefined) {
      req.write(body);
    }
    req.end();
  });
}

const authed = (extra = {}) => ({ Origin: ALLOWED, Authorization: bearer(ADMIN_TOKEN()), ...extra });

describe('CORS and routing, over a socket', () => {
  it('answers a preflight, echoing Authorization as an allowed header', async () => {
    await withServer({}, async ({ port }) => {
      const response = await send(port, { method: 'OPTIONS', headers: { Origin: ALLOWED } });
      assert.equal(response.status, 204);
      assert.equal(response.headers['access-control-allow-origin'], ALLOWED);
      assert.equal(response.headers['access-control-allow-methods'], ALLOWED_METHODS);
      assert.match(response.headers['access-control-allow-headers'], /Authorization/);
    });
  });

  it('refuses a present-but-unlisted origin before checking auth at all', async () => {
    await withServer({}, async ({ port, calls }) => {
      const response = await send(port, { headers: { Origin: 'https://evil.example.com' } });
      assert.equal(response.status, 403);
      assert.deepEqual(calls.list, []);
    });
  });

  it('404s an unknown path', async () => {
    await withServer({}, async ({ port }) => {
      const response = await send(port, { path: '/nope', headers: authed() });
      assert.equal(response.status, 404);
    });
  });
});

describe('auth, over a socket', () => {
  it('401s with no Authorization header, before any handler runs', async () => {
    await withServer({}, async ({ port, calls }) => {
      const response = await send(port, { headers: { Origin: ALLOWED } });
      assert.equal(response.status, 401);
      assert.deepEqual(calls.list, []);
    });
  });

  it("403s a valid token that lacks MANAGE_OPERATORS, naming what it lacks", async () => {
    await withServer({}, async ({ port, calls }) => {
      const token = mint({ permissions: ['sale:process'] });
      const response = await send(port, { headers: { Origin: ALLOWED, Authorization: bearer(token) } });
      assert.equal(response.status, 403);
      assert.match(response.json.error, /admin:manage_operators/);
      assert.deepEqual(calls.list, []);
    });
  });

  it('401s an expired token', async () => {
    await withServer({}, async ({ port }) => {
      const token = mint({ exp: NOW - 1 });
      const response = await send(port, { headers: { Origin: ALLOWED, Authorization: bearer(token) } });
      assert.equal(response.status, 401);
    });
  });
});

describe('GET /appid/admin/roles', () => {
  it('returns the assignable roles', async () => {
    await withServer({}, async ({ port, calls }) => {
      const response = await send(port, { path: '/appid/admin/roles', headers: authed() });
      assert.equal(response.status, 200);
      assert.deepEqual(response.json, [{ id: 'role-admin', name: 'admin' }]);
      assert.equal(calls.listRoles.length, 1);
    });
  });
});

describe('GET /appid/admin/staff', () => {
  it('returns the staff list', async () => {
    await withServer({}, async ({ port, calls }) => {
      const response = await send(port, { headers: authed() });
      assert.equal(response.status, 200);
      assert.equal(response.json.length, 1);
      assert.equal(calls.list.length, 1);
    });
  });
});

describe('POST /appid/admin/staff', () => {
  it('creates a staff member and returns the new identity', async () => {
    await withServer({}, async ({ port, calls }) => {
      const response = await send(port, {
        method: 'POST',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@capy.test', roleId: 'role-admin' }),
      });
      assert.equal(response.status, 200);
      assert.equal(response.json.email, 'new@capy.test');
      assert.deepEqual(calls.create, [{ email: 'new@capy.test', roleId: 'role-admin' }]);
    });
  });

  it("400s a body the validator rejects, and never reaches create", async () => {
    await withServer({}, async ({ port, calls }) => {
      const response = await send(port, {
        method: 'POST',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: 'new@capy.test' }),
      });
      assert.equal(response.status, 400);
      assert.deepEqual(calls.create, []);
    });
  });

  it('413s a body over the cap without buffering it or calling the Management API', async () => {
    await withServer({}, async ({ port, calls }) => {
      const chunk = 'x'.repeat(512);
      const response = await send(port, {
        method: 'POST',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        chunks: Array.from({ length: 10 }, () => chunk),
      });
      assert.equal(response.status, 413);
      assert.deepEqual(calls.create, []);
    });
  });

  it('502s when create throws, without leaking the reason', async () => {
    await withServer(
      { create: async () => { throw new Error('APPID_MANAGEMENT_APIKEY=super-secret rejected upstream'); } },
      async ({ port }) => {
        const response = await send(port, {
          method: 'POST',
          headers: { ...authed(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: 'new@capy.test', roleId: 'role-admin' }),
        });
        assert.equal(response.status, 502);
        assert.doesNotMatch(response.text, /super-secret/, 'the 502 body leaked the management key');
      }
    );
  });
});

describe('PUT /appid/admin/staff/{id}/role', () => {
  it('reassigns the role', async () => {
    await withServer({}, async ({ port, calls }) => {
      const response = await send(port, {
        method: 'PUT',
        path: '/appid/admin/staff/u1/role',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId: 'role-manager' }),
      });
      assert.equal(response.status, 204);
      assert.deepEqual(calls.reassignRole, [{ userId: 'u1', request: { roleId: 'role-manager' } }]);
    });
  });

  it('URL-decodes the id segment', async () => {
    await withServer({}, async ({ port, calls }) => {
      const response = await send(port, {
        method: 'PUT',
        path: '/appid/admin/staff/u%201/role',
        headers: { ...authed(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ roleId: 'role-manager' }),
      });
      assert.equal(response.status, 204);
      assert.equal(calls.reassignRole[0].userId, 'u 1');
    });
  });
});

describe('DELETE /appid/admin/staff/{id}/role', () => {
  it('revokes with no body, and answers 204', async () => {
    await withServer({}, async ({ port, calls }) => {
      const response = await send(port, { method: 'DELETE', path: '/appid/admin/staff/u1/role', headers: authed() });
      assert.equal(response.status, 204);
      assert.deepEqual(calls.revoke, ['u1']);
    });
  });
});
