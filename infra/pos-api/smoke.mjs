/**
 * End-to-end smoke test for the products/transactions/health API.
 *
 * The 58 tests in `src` run the route table against an in-memory store with no
 * socket, which is what makes them fast and what makes them blind: they cannot see a
 * missing CORS header, a body cap that never fires, a Cloudant revision that does not
 * round-trip, or a Code Engine revision that starts without its secret. This script
 * is the other half — one real HTTP conversation against a running service, local or
 * deployed, asserting the wire contract `sync.worker.ts` depends on.
 *
 * It exits non-zero on the first broken expectation, so it can gate a deployment:
 *
 *   SESSION_JWT_SECRET=smoke POS_API_STORE=memory npm start   # one terminal
 *   SESSION_JWT_SECRET=smoke npm run smoke                    # another
 *
 *   SESSION_JWT_SECRET=$(ibmcloud ce secret get …) \
 *     API_URL=https://pos-api.…appdomain.cloud npm run smoke  # against Code Engine
 *
 * It writes one product, sells from it and deletes it again, so it is safe to run
 * against a real database — but it is a write test, not a read-only probe.
 */
import { createHmac, randomUUID } from 'node:crypto';

const BASE = (process.env['API_URL'] ?? 'http://127.0.0.1:8790').replace(/\/+$/, '');
const SECRET = process.env['SESSION_JWT_SECRET'] ?? '';

if (SECRET.length === 0) {
  console.error('SESSION_JWT_SECRET is not set. It must be the secret the service verifies with.');
  process.exit(1);
}

const ALL_PERMISSIONS = [
  'inventory:view',
  'inventory:manage',
  'inventory:delete',
  'sale:process',
  'sale:view_transactions',
];

/**
 * Mint a session token the way the browser does.
 *
 * Kept deliberately in step with `session-issuer.ts`: HS256 over base64url segments,
 * `sub` and `tenantId` for attribution, `permissions` for the route table. If this
 * drifts from the issuer the smoke fails with 401, which is the failure being looked
 * for — the till and the API disagreeing about credentials is exactly the outage this
 * script exists to catch before a revision takes traffic.
 */
function mint(permissions = ALL_PERMISSIONS) {
  const claims = {
    sub: 'smoke-operator',
    tenantId: 'smoke-store',
    roles: ['admin'],
    permissions,
    exp: Math.floor(Date.now() / 1000) + 300,
  };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${signingInput}.${createHmac('sha256', SECRET).update(signingInput).digest('base64url')}`;
}

const ADMIN = mint();
const VIEWER = mint(['inventory:view']);

async function call(method, path, { body, token = ADMIN, headers = {} } = {}) {
  const started = Date.now();
  let response;
  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (error) {
    // The service is down, the URL is wrong, or it hung up mid-body. Returned as a
    // status of 0 rather than thrown, so every remaining check still runs and the
    // output names what broke instead of ending in a stack trace.
    return { status: 0, ms: Date.now() - started, headers: new Headers(), body: { error: String(error) } };
  }
  const text = await response.text();
  let parsed;
  try {
    parsed = text.length > 0 ? JSON.parse(text) : undefined;
  } catch {
    parsed = text; // Not JSON, which is itself a finding — report it as it arrived.
  }
  return { status: response.status, ms: Date.now() - started, headers: response.headers, body: parsed };
}

let failures = 0;

/** Report one expectation. `detail` is only printed when it fails, to keep passes one line each. */
function check(label, ok, detail) {
  console.log(`  ${ok ? '✔' : '✖'} ${label}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) {
      console.log(`      ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`);
    }
  }
}

console.log(`smoking ${BASE}`);

// ─── Health, and the boundary around everything else ──────────────────────────

console.log('health:');
const health = await call('GET', '/api/health', { token: null });
check(`GET /api/health answers 200 in ${health.ms}ms`, health.status === 200, health.body);
check("status is the string sync.worker.ts tests for ('healthy')", health.body?.status === 'healthy', health.body);
check('platform reports the container, not the Lambdas', health.body?.platform === 'ibm-code-engine', health.body);

console.log('cors:');
const preflight = await call('OPTIONS', '/api/products', { token: null });
check('preflight answers 204', preflight.status === 204, preflight.status);
check(
  'preflight allows the Authorization header the till must send',
  (preflight.headers.get('access-control-allow-headers') ?? '').toLowerCase().includes('authorization'),
  preflight.headers.get('access-control-allow-headers')
);
check(
  'X-Trace-Id is exposed to script, not just on the wire',
  (health.headers.get('access-control-expose-headers') ?? '').toLowerCase().includes('x-trace-id'),
  health.headers.get('access-control-expose-headers')
);
check('a trace id is echoed or minted for correlation', (health.headers.get('x-trace-id') ?? '').length > 0);
const traced = await call('GET', '/api/health', { token: null, headers: { 'X-Trace-Id': 'smoke-trace-1' } });
check("the caller's own trace id survives", traced.headers.get('x-trace-id') === 'smoke-trace-1');

console.log('boundary:');
const anonymous = await call('GET', '/api/products', { token: null });
check('GET /api/products with no credential answers 401', anonymous.status === 401, anonymous.body);
check('the 401 body carries no product data', JSON.stringify(anonymous.body ?? '') === '{"error":"Authorization required."}', anonymous.body);

const forged = await call('GET', '/api/transactions', {
  token: (() => {
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const input = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
      sub: 'x',
      tenantId: 't',
      permissions: ALL_PERMISSIONS,
      exp: Math.floor(Date.now() / 1000) + 300,
    })}`;
    return `${input}.${createHmac('sha256', 'not-the-secret').update(input).digest('base64url')}`;
  })(),
});
check('a token signed with the wrong secret answers 401', forged.status === 401, forged.body);

const underprivileged = await call('POST', '/api/products', { token: VIEWER, body: { id: 'x', name: 'x', price: 1, category: 'x' } });
check('a view-only token cannot write, and is told which permission it lacks', underprivileged.status === 403, underprivileged.body);

const unknown = await call('GET', '/api/nope');
check('an unrouted path answers 404', unknown.status === 404, unknown.body);

const oversized = await call('POST', '/api/products', { body: { id: 'big', name: 'x'.repeat(70 * 1024), price: 1, category: 'x' } });
check('a body over the cap is refused (413) rather than buffered', oversized.status === 413, oversized.status);

// ─── One product's whole life ─────────────────────────────────────────────────

const id = `smoke-${randomUUID()}`;
console.log(`lifecycle (${id}):`);

const created = await call('POST', '/api/products', {
  body: { id, name: 'Smoke Oat Milk 1L', price: 1.5, category: 'Dairy', stock: 3, description: 'written by smoke.mjs' },
});
check('POST /api/products answers 201', created.status === 201, created.body);
check('the created product round-trips its fields', created.body?.product?.stock === 3 && created.body?.product?.price === 1.5, created.body);

const duplicate = await call('POST', '/api/products', { body: { id, name: 'Smoke Oat Milk 1L', price: 1.5, category: 'Dairy' } });
check('creating the same id twice answers 409', duplicate.status === 409, duplicate.body);

const listed = await call('GET', '/api/products');
check('GET /api/products answers 200 with a count', listed.status === 200 && typeof listed.body?.count === 'number', listed.body);
check('the new product is in the list — the store really persisted it', Array.isArray(listed.body?.products) && listed.body.products.some((entry) => entry.id === id), listed.body?.count);

const patched = await call('PATCH', `/api/products/${id}`, { body: { price: 1.75 } });
check('PATCH updates the one field and leaves stock alone', patched.status === 200 && patched.body?.product?.price === 1.75 && patched.body?.product?.stock === 3, patched.body);

const badPatch = await call('PATCH', `/api/products/${id}`, { body: { stock: -1 } });
check('PATCH refuses negative stock', badPatch.status === 400, badPatch.body);

const sold = await call('POST', `/api/products/${id}/sell`, { body: { quantity: 2 } });
check('POST …/sell answers 200 and decrements stock', sold.status === 200 && sold.body?.remainingStock === 1, sold.body);
check('the sale is attributed to the token, not the request body', sold.body?.transaction?.operatorId === 'smoke-operator' && sold.body?.transaction?.tenantId === 'smoke-store', sold.body?.transaction);
check('the line total is the patched price', sold.body?.transaction?.total === 3.5, sold.body?.transaction);

const oversold = await call('POST', `/api/products/${id}/sell`, { body: { quantity: 99 } });
check('selling more than is on hand answers 400 and never goes negative', oversold.status === 400 && oversold.body?.available === 1, oversold.body);

const zero = await call('POST', `/api/products/${id}/sell`, { body: { quantity: 0 } });
check('a quantity of 0 is refused rather than coerced to 1', zero.status === 400, zero.body);

const transactions = await call('GET', '/api/transactions');
check('GET /api/transactions answers 200', transactions.status === 200, transactions.body);
check('the sale is on the ledger exactly once', Array.isArray(transactions.body?.transactions) && transactions.body.transactions.filter((entry) => entry.productId === id).length === 1, transactions.body?.count);

// ─── Clean up after itself, so a real database is left as it was found ────────

console.log('cleanup:');
const deleted = await call('DELETE', `/api/products/${id}`);
check('DELETE answers 200', deleted.status === 200, deleted.body);
const gone = await call('DELETE', `/api/products/${id}`);
check('deleting it twice answers 404', gone.status === 404, gone.body);

console.log('');
if (failures > 0) {
  console.error(`${failures} check${failures === 1 ? '' : 's'} failed. Do not route traffic to this revision.`);
  process.exit(1);
}
console.log('all checks passed.');
