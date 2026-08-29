/**
 * The suite for the route table.
 *
 * Runs all eight routes against the in-memory store: every status code, every
 * permission refusal, and the stock race. No socket and no IBM account, which is why
 * `api.ts` takes its store, clock and id generator as parameters — a route table
 * that could only be tested by deploying it would not have been tested.
 *
 * Two groups matter more than the rest. The `boundary` group is the acceptance
 * criterion of this story stated as tests: no valid credential, no product or
 * transaction data. The `overselling` group is the bug in the Lambda this replaces —
 * see the comment on `sellProduct`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { handle, matchRoute } from './api.ts';
import { MemoryStore } from '../../shared/src/document-store.ts';
import { Permission } from './session-auth.ts';

const SECRET = 'test-secret';
const NOW = 1_800_000_000;
const ISO = '2027-01-15T10:00:00.000Z';

const ADMIN = [
  Permission.VIEW_INVENTORY,
  Permission.MANAGE_INVENTORY,
  Permission.DELETE_PRODUCT,
  Permission.PROCESS_SALE,
  Permission.VIEW_TRANSACTIONS,
];
const MANAGER = [
  Permission.VIEW_INVENTORY,
  Permission.MANAGE_INVENTORY,
  Permission.PROCESS_SALE,
  Permission.VIEW_TRANSACTIONS,
];

function mint(permissions = ADMIN, payload = {}) {
  const claims = { sub: 'op-1', tenantId: 'store-1', roles: ['admin'], permissions, exp: NOW + 3600, ...payload };
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const signingInput = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(claims)}`;
  return `${signingInput}.${createHmac('sha256', SECRET).update(signingInput).digest('base64url')}`;
}

function product(overrides = {}) {
  return {
    id: 'p-1',
    name: 'Oat Milk 1L',
    price: 1.5,
    category: 'Dairy',
    stock: 10,
    description: '',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/** A fresh set of deps per test, so no test can see another's writes. */
function deps({ products = [product()], transactions = [], productStore } = {}) {
  let counter = 0;
  return {
    products: productStore ?? new MemoryStore(products),
    transactions: new MemoryStore(transactions),
    secret: SECRET,
    nowSeconds: () => NOW,
    nowIso: () => ISO,
    newId: () => `txn-${++counter}`,
  };
}

/** Issue a request as an authorized admin unless told otherwise. */
function call(method, path, { body, token = mint(), authorization } = {}, context = deps()) {
  return handle(
    {
      method,
      path,
      authorization: authorization !== undefined ? authorization : token === null ? undefined : `Bearer ${token}`,
      body,
    },
    context
  );
}

describe('matchRoute', () => {
  it('matches the eight routes terraform/aws-demo/main.tf declares', () => {
    assert.deepEqual(matchRoute('GET', '/api/health'), { kind: 'health' });
    assert.equal(matchRoute('GET', '/api/products')?.kind, 'listProducts');
    assert.equal(matchRoute('POST', '/api/products')?.kind, 'createProduct');
    assert.equal(matchRoute('PUT', '/api/products/p-1')?.kind, 'replaceProduct');
    assert.equal(matchRoute('PATCH', '/api/products/p-1')?.kind, 'patchProduct');
    assert.equal(matchRoute('DELETE', '/api/products/p-1')?.kind, 'deleteProduct');
    assert.equal(matchRoute('POST', '/api/products/p-1/sell')?.kind, 'sellProduct');
    assert.equal(matchRoute('GET', '/api/transactions')?.kind, 'listTransactions');
  });

  it('binds each route to the permission its operation needs', () => {
    assert.equal(matchRoute('GET', '/api/products')?.permission, 'inventory:view');
    assert.equal(matchRoute('POST', '/api/products')?.permission, 'inventory:manage');
    assert.equal(matchRoute('DELETE', '/api/products/p-1')?.permission, 'inventory:delete');
    assert.equal(matchRoute('POST', '/api/products/p-1/sell')?.permission, 'sale:process');
    assert.equal(matchRoute('GET', '/api/transactions')?.permission, 'sale:view_transactions');
  });

  it('is case-insensitive on the method, as HTTP is', () => {
    assert.equal(matchRoute('get', '/api/health')?.kind, 'health');
  });

  it('decodes the id segment', () => {
    assert.equal(matchRoute('DELETE', '/api/products/p%2F1')?.id, 'p/1');
  });

  it('refuses anything outside the table', () => {
    for (const [method, path] of [
      ['GET', '/'],
      ['GET', '/health'],
      ['GET', '/api'],
      ['GET', '/api/unknown'],
      ['POST', '/api/health'],
      ['DELETE', '/api/products'],
      ['GET', '/api/products/p-1'],
      ['POST', '/api/products/p-1'],
      ['GET', '/api/products/p-1/sell'],
      ['POST', '/api/products/p-1/sell/again'],
      ['POST', '/api/products//sell'],
      ['POST', '/api/products/%ZZ/sell'],
      ['GET', '/api/transactions/t-1'],
    ]) {
      assert.equal(matchRoute(method, path), null, `${method} ${path}`);
    }
  });

  it('ignores trailing and doubled slashes rather than 404-ing a real route', () => {
    assert.equal(matchRoute('GET', '/api/health/')?.kind, 'health');
    assert.equal(matchRoute('GET', '//api//products')?.kind, 'listProducts');
  });
});

describe('the auth boundary, as the story states it', () => {
  const protectedRoutes = [
    ['GET', '/api/products'],
    ['POST', '/api/products'],
    ['PUT', '/api/products/p-1'],
    ['PATCH', '/api/products/p-1'],
    ['DELETE', '/api/products/p-1'],
    ['POST', '/api/products/p-1/sell'],
    ['GET', '/api/transactions'],
  ];

  it('rejects every data route with no credential', async () => {
    for (const [method, path] of protectedRoutes) {
      const response = await call(method, path, { token: null });
      assert.equal(response.status, 401, `${method} ${path}`);
      assert.deepEqual(response.body, { error: 'Authorization required.' });
    }
  });

  it('rejects every data route with a forged credential', async () => {
    const forged = (() => {
      const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
      const input = `${encode({ alg: 'HS256' })}.${encode({ sub: 'x', tenantId: 't', permissions: ADMIN, exp: NOW + 60 })}`;
      return `${input}.${createHmac('sha256', 'wrong-secret').update(input).digest('base64url')}`;
    })();
    for (const [method, path] of protectedRoutes) {
      assert.equal((await call(method, path, { token: forged })).status, 401, `${method} ${path}`);
    }
  });

  it('leaks no product or transaction data in any rejection body', async () => {
    const context = deps({ transactions: [{ id: 't-1', productName: 'Oat Milk 1L', timestamp: ISO }] });
    for (const [method, path] of protectedRoutes) {
      const response = await call(method, path, { token: null }, context);
      assert.ok(!JSON.stringify(response.body).includes('Oat Milk'), `${method} ${path} leaked a product name`);
    }
  });

  it('leaves health reachable without a credential, for the platform probe', async () => {
    const response = await call('GET', '/api/health', { token: null });
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'healthy');
  });

  it('answers 404 for an unknown path without consulting the token', async () => {
    assert.equal((await call('GET', '/api/nope', { token: null })).status, 404);
  });
});

describe('GET /api/health', () => {
  it('reports the shape sync.worker.ts checkHealth() parses', async () => {
    const { body } = await call('GET', '/api/health', { token: null });
    // `checkHealth` tests `data.status === 'healthy'`, so the string is a wire contract.
    assert.equal(body.status, 'healthy');
    assert.equal(body.service, 'capy-pos-api');
    assert.equal(body.timestamp, ISO);
  });

  it('describes what is actually answering, not the Lambda split it replaced', async () => {
    const { body } = await call('GET', '/api/health', { token: null });
    assert.equal(body.architecture, 'single-container');
    assert.equal(body.platform, 'ibm-code-engine');
  });
});

describe('GET /api/products', () => {
  it('returns { products, count }, the shape sync.worker.ts syncProducts() reads', async () => {
    const { status, body } = await call('GET', '/api/products');
    assert.equal(status, 200);
    assert.equal(body.count, 1);
    assert.equal(body.products[0].name, 'Oat Milk 1L');
  });

  it('returns an empty list rather than 404 for an empty catalogue', async () => {
    const { status, body } = await call('GET', '/api/products', {}, deps({ products: [] }));
    assert.equal(status, 200);
    assert.deepEqual(body, { products: [], count: 0 });
  });
});

describe('POST /api/products', () => {
  it('creates and returns 201 with the stored product', async () => {
    const context = deps({ products: [] });
    const { status, body } = await call(
      'POST',
      '/api/products',
      { body: { id: 'p-9', name: 'Banana', price: 0.35, category: 'Produce', stock: 40 } },
      context
    );
    assert.equal(status, 201);
    assert.deepEqual(body.product, {
      id: 'p-9',
      name: 'Banana',
      price: 0.35,
      category: 'Produce',
      stock: 40,
      description: '',
      createdAt: ISO,
      updatedAt: ISO,
    });
    assert.equal((await context.products.read('p-9'))?.document.name, 'Banana');
  });

  it('defaults stock to zero and floors a fractional one', async () => {
    const base = { id: 'p-9', name: 'Banana', price: 0.35, category: 'Produce' };
    const noStock = await call('POST', '/api/products', { body: base }, deps({ products: [] }));
    assert.equal(noStock.body.product.stock, 0);
    const fractional = await call('POST', '/api/products', { body: { ...base, stock: 4.7 } }, deps({ products: [] }));
    assert.equal(fractional.body.product.stock, 4);
  });

  it('answers 409 rather than overwriting an existing id', async () => {
    const { status, body } = await call('POST', '/api/products', {
      body: { id: 'p-1', name: 'Impostor', price: 1, category: 'Dairy' },
    });
    assert.equal(status, 409);
    assert.equal(body.error, 'Product with this ID already exists');
  });

  it('answers 400 for a missing or unusable required field', async () => {
    const complete = { id: 'p-9', name: 'Banana', price: 0.35, category: 'Produce' };
    const broken = [
      {},
      { ...complete, id: undefined },
      { ...complete, id: '   ' },
      { ...complete, name: undefined },
      { ...complete, name: '' },
      { ...complete, category: undefined },
      { ...complete, price: undefined },
      // A string price is the #110 class of bug: coerced, it stores NaN forever.
      { ...complete, price: '0.35' },
      { ...complete, price: Number.NaN },
      { ...complete, price: -1 },
    ];
    for (const body of broken) {
      const response = await call('POST', '/api/products', { body }, deps({ products: [] }));
      assert.equal(response.status, 400, JSON.stringify(body));
    }
  });

  it('answers 400 for a body that is not a JSON object', async () => {
    for (const body of [undefined, null, 'a string', 42, [1, 2]]) {
      assert.equal((await call('POST', '/api/products', { body }, deps({ products: [] }))).status, 400);
    }
  });
});

describe('PUT /api/products/{id}', () => {
  it('replaces the product and preserves the original createdAt', async () => {
    const { status, body } = await call('PUT', '/api/products/p-1', {
      body: { name: 'Oat Milk 2L', price: 2.5, category: 'Dairy', stock: 5, description: 'bigger' },
    });
    assert.equal(status, 200);
    assert.equal(body.product.name, 'Oat Milk 2L');
    assert.equal(body.product.createdAt, '2026-01-01T00:00:00.000Z');
    assert.equal(body.product.updatedAt, ISO);
  });

  it('answers 404 for a product that does not exist, rather than creating it', async () => {
    const context = deps();
    const { status } = await call(
      'PUT',
      '/api/products/ghost',
      { body: { name: 'Ghost', price: 1, category: 'Dairy' } },
      context
    );
    assert.equal(status, 404);
    assert.equal(await context.products.read('ghost'), null);
  });

  it('answers 400 when a required field is missing, since PUT is a full replace', async () => {
    assert.equal((await call('PUT', '/api/products/p-1', { body: { name: 'Only a name' } })).status, 400);
  });
});

describe('PATCH /api/products/{id}', () => {
  it('updates only the fields provided', async () => {
    const { status, body } = await call('PATCH', '/api/products/p-1', { body: { stock: 3 } });
    assert.equal(status, 200);
    assert.equal(body.product.stock, 3);
    assert.equal(body.product.name, 'Oat Milk 1L');
    assert.equal(body.product.price, 1.5);
    assert.equal(body.product.updatedAt, ISO);
  });

  it('supports the soft delete the UI relies on', async () => {
    const { body } = await call('PATCH', '/api/products/p-1', { body: { isActive: false } });
    assert.equal(body.product.isActive, false);
  });

  it('answers 400 when no mutable field was provided', async () => {
    const { status, body } = await call('PATCH', '/api/products/p-1', { body: { id: 'p-2', createdAt: ISO } });
    assert.equal(status, 400);
    assert.match(body.error, /No updatable fields provided/);
  });

  it('refuses to write a server-owned field', async () => {
    const context = deps();
    await call('PATCH', '/api/products/p-1', { body: { id: 'p-hijack', stock: 1 } }, context);
    assert.equal(await context.products.read('p-hijack'), null);
    assert.equal((await context.products.read('p-1'))?.document.stock, 1);
  });

  it('answers 400 for a field of the wrong type instead of coercing it', async () => {
    for (const body of [{ price: '2' }, { stock: 'many' }, { stock: -1 }, { isActive: 'false' }, { name: '' }]) {
      assert.equal((await call('PATCH', '/api/products/p-1', { body })).status, 400, JSON.stringify(body));
    }
  });

  it('answers 404 for a product that does not exist', async () => {
    assert.equal((await call('PATCH', '/api/products/ghost', { body: { stock: 1 } })).status, 404);
  });
});

describe('DELETE /api/products/{id}', () => {
  it('deletes and returns the removed product', async () => {
    const context = deps();
    const { status, body } = await call('DELETE', '/api/products/p-1', {}, context);
    assert.equal(status, 200);
    assert.equal(body.message, 'Product deleted');
    assert.equal(body.product.name, 'Oat Milk 1L');
    assert.equal(await context.products.read('p-1'), null);
  });

  it('answers 404 rather than succeeding silently for a missing product', async () => {
    assert.equal((await call('DELETE', '/api/products/ghost')).status, 404);
  });

  /**
   * The first server-side authorization decision in this repo. Until now roles were
   * enforced only by browser guards and directives, which anyone can bypass with
   * `curl`. A manager token is authenticated and can do everything else here.
   */
  it('refuses a manager token, which lacks inventory:delete', async () => {
    const context = deps();
    const { status, body } = await call('DELETE', '/api/products/p-1', { token: mint(MANAGER) }, context);
    assert.equal(status, 403);
    assert.equal(body.error, 'Requires inventory:delete.');
    assert.notEqual(await context.products.read('p-1'), null, 'the product must survive a refused delete');
  });
});
