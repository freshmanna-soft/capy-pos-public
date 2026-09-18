import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CloudantStore } from './cloudant-store.ts';
import { migrateCheckoutDatabase } from './checkout-migration.ts';
import { CHECKOUT_DUE_INDEX_DDOC, CHECKOUT_DUE_INDEX_NAME } from './cloudant-checkout-store.ts';

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function migration(options = {}) {
  const calls = [];
  const cloudantResponses = [
    response(200, {
      result: options.result ?? 'created',
      id: `_design/${CHECKOUT_DUE_INDEX_DDOC}`,
      name: CHECKOUT_DUE_INDEX_NAME,
    }),
    response(200, { docs: [] }),
    ...(options.cloudantResponses ?? []),
  ];
  const store = new CloudantStore(
    { url: 'https://cloudant.example', apiKey: 'key', database: 'checkouts' },
    async (target, init = {}) => {
      calls.push({ url: String(target), init });
      if (String(target) === 'https://iam.cloud.ibm.com/identity/token') {
        return response(200, { access_token: 'token', expires_in: 3600 });
      }
      return cloudantResponses.shift() ?? response(500, {});
    }
  );
  return { store, calls };
}

function cloudantCalls(calls) {
  return calls.filter(({ url }) => url !== 'https://iam.cloud.ibm.com/identity/token');
}

describe('checkout Cloudant migration', () => {
  it('creates the exact due index then verifies Cloudant can select it', async () => {
    const ctx = migration();

    const result = await migrateCheckoutDatabase(ctx.store, 'checkouts');

    const [create, verify] = cloudantCalls(ctx.calls);
    assert.equal(create.url, 'https://cloudant.example/checkouts/_index');
    assert.deepEqual(JSON.parse(create.init.body), {
      index: { fields: ['kind', 'nextActionAt', 'id'] },
      ddoc: CHECKOUT_DUE_INDEX_DDOC,
      name: CHECKOUT_DUE_INDEX_NAME,
      type: 'json',
      partitioned: false,
    });
    assert.equal(verify.url, 'https://cloudant.example/checkouts/_find');
    assert.deepEqual(JSON.parse(verify.init.body).use_index, [
      CHECKOUT_DUE_INDEX_DDOC,
      CHECKOUT_DUE_INDEX_NAME,
    ]);
    assert.deepEqual(JSON.parse(verify.init.body).sort, [{ nextActionAt: 'asc' }, { id: 'asc' }]);
    assert.deepEqual(result, {
      database: 'checkouts',
      designDocument: CHECKOUT_DUE_INDEX_DDOC,
      index: CHECKOUT_DUE_INDEX_NAME,
      outcome: 'created',
    });
  });

  it('accepts an idempotent existing-index result and still verifies it', async () => {
    const ctx = migration({ result: 'exists' });

    const result = await migrateCheckoutDatabase(ctx.store, 'checkouts');

    assert.equal(result.outcome, 'exists');
    assert.equal(cloudantCalls(ctx.calls).length, 2);
  });

  it('fails closed on malformed index creation responses', async () => {
    for (const body of [
      { result: 'created', id: '_design/wrong', name: CHECKOUT_DUE_INDEX_NAME },
      { result: 'created', id: `_design/${CHECKOUT_DUE_INDEX_DDOC}`, name: 'wrong' },
      {
        result: 'unexpected',
        id: `_design/${CHECKOUT_DUE_INDEX_DDOC}`,
        name: CHECKOUT_DUE_INDEX_NAME,
      },
    ]) {
      const ctx = migration({
        cloudantResponses: [],
      });
      const responses = [response(200, body)];
      ctx.store = new CloudantStore(
        { url: 'https://cloudant.example', apiKey: 'key', database: 'checkouts' },
        async (target) => {
          if (String(target) === 'https://iam.cloud.ibm.com/identity/token') {
            return response(200, { access_token: 'token', expires_in: 3600 });
          }
          return responses.shift() ?? response(500, {});
        }
      );
      await assert.rejects(migrateCheckoutDatabase(ctx.store, 'checkouts'), /invalid response/);
    }
  });

  it('fails when creation or verification does not succeed', async () => {
    const failedCreate = migration({ cloudantResponses: [] });
    const createResponses = [response(503, {})];
    failedCreate.store = new CloudantStore(
      { url: 'https://cloudant.example', apiKey: 'key', database: 'checkouts' },
      async (target) => {
        if (String(target) === 'https://iam.cloud.ibm.com/identity/token') {
          return response(200, { access_token: 'token', expires_in: 3600 });
        }
        return createResponses.shift() ?? response(500, {});
      }
    );
    await assert.rejects(migrateCheckoutDatabase(failedCreate.store, 'checkouts'), /creation.*503/);

    const failedVerify = migration({
      cloudantResponses: [],
    });
    const verifyResponses = [
      response(200, {
        result: 'created',
        id: `_design/${CHECKOUT_DUE_INDEX_DDOC}`,
        name: CHECKOUT_DUE_INDEX_NAME,
      }),
      response(400, {}),
    ];
    failedVerify.store = new CloudantStore(
      { url: 'https://cloudant.example', apiKey: 'key', database: 'checkouts' },
      async (target) => {
        if (String(target) === 'https://iam.cloud.ibm.com/identity/token') {
          return response(200, { access_token: 'token', expires_in: 3600 });
        }
        return verifyResponses.shift() ?? response(500, {});
      }
    );
    await assert.rejects(
      migrateCheckoutDatabase(failedVerify.store, 'checkouts'),
      /verification.*400/
    );
  });

  it('rejects malformed verification bodies and database labels', async () => {
    const responses = [
      response(200, {
        result: 'created',
        id: `_design/${CHECKOUT_DUE_INDEX_DDOC}`,
        name: CHECKOUT_DUE_INDEX_NAME,
      }),
      response(200, {}),
    ];
    const store = new CloudantStore(
      { url: 'https://cloudant.example', apiKey: 'key', database: 'checkouts' },
      async (target) => {
        if (String(target) === 'https://iam.cloud.ibm.com/identity/token') {
          return response(200, { access_token: 'token', expires_in: 3600 });
        }
        return responses.shift() ?? response(500, {});
      }
    );

    await assert.rejects(migrateCheckoutDatabase(store, 'checkouts'), /no docs array/);
    await assert.rejects(migrateCheckoutDatabase(store, 'bad\ndatabase'), /database name/);
  });
});
