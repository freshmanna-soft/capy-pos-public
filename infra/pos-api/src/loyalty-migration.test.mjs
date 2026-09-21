import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CloudantStore } from './cloudant-store.ts';
import {
  CHECKOUT_LOYALTY_DUE_INDEX_DDOC,
  CHECKOUT_LOYALTY_DUE_INDEX_NAME,
  LOYALTY_LEDGER_INDEX_DDOC,
  LOYALTY_LEDGER_INDEX_NAME,
  migrateLoyaltyDatabases,
} from './loyalty-migration.ts';

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function migration(responses = []) {
  const calls = [];
  const cloudantResponses = [...responses];
  const fetchImpl = async (target, init = {}) => {
    calls.push({ url: String(target), init });
    if (String(target) === 'https://iam.cloud.ibm.com/identity/token') {
      return response(200, { access_token: 'token', expires_in: 3600 });
    }
    return cloudantResponses.shift() ?? response(500, {});
  };
  return {
    calls,
    input: {
      ledgerStore: new CloudantStore(
        { url: 'https://cloudant.example', apiKey: 'key', database: 'loyalty-ledger' },
        fetchImpl
      ),
      ledgerDatabase: 'loyalty-ledger',
      checkoutStore: new CloudantStore(
        { url: 'https://cloudant.example', apiKey: 'key', database: 'checkouts' },
        fetchImpl
      ),
      checkoutDatabase: 'checkouts',
    },
  };
}

function successfulResponses(result = 'created') {
  return [
    response(200, {
      result,
      id: `_design/${LOYALTY_LEDGER_INDEX_DDOC}`,
      name: LOYALTY_LEDGER_INDEX_NAME,
    }),
    response(200, { docs: [] }),
    response(200, {
      result,
      id: `_design/${CHECKOUT_LOYALTY_DUE_INDEX_DDOC}`,
      name: CHECKOUT_LOYALTY_DUE_INDEX_NAME,
    }),
    response(200, { docs: [] }),
  ];
}

function cloudantCalls(calls) {
  return calls.filter(({ url }) => url !== 'https://iam.cloud.ibm.com/identity/token');
}

describe('loyalty Cloudant migration', () => {
  it('creates and verifies the customer-sequence and completed-checkout due indexes', async () => {
    const ctx = migration(successfulResponses());

    const result = await migrateLoyaltyDatabases(ctx.input);

    const [ledgerCreate, ledgerVerify, checkoutCreate, checkoutVerify] = cloudantCalls(ctx.calls);
    assert.equal(ledgerCreate.url, 'https://cloudant.example/loyalty-ledger/_index');
    assert.deepEqual(JSON.parse(ledgerCreate.init.body), {
      index: { fields: ['kind', 'customerKey', 'sequence', 'id'] },
      ddoc: LOYALTY_LEDGER_INDEX_DDOC,
      name: LOYALTY_LEDGER_INDEX_NAME,
      type: 'json',
      partitioned: false,
    });
    assert.deepEqual(JSON.parse(ledgerVerify.init.body).sort, [{ sequence: 'asc' }, { id: 'asc' }]);
    assert.equal(checkoutCreate.url, 'https://cloudant.example/checkouts/_index');
    assert.deepEqual(JSON.parse(checkoutCreate.init.body), {
      index: {
        fields: ['kind', 'state', 'loyalty.status', 'loyalty.nextActionAt', 'id'],
      },
      ddoc: CHECKOUT_LOYALTY_DUE_INDEX_DDOC,
      name: CHECKOUT_LOYALTY_DUE_INDEX_NAME,
      type: 'json',
      partitioned: false,
    });
    assert.deepEqual(JSON.parse(checkoutVerify.init.body).selector, {
      kind: { $eq: 'checkout' },
      state: { $eq: 'completed' },
      'loyalty.status': { $eq: 'pending' },
      'loyalty.nextActionAt': { $gt: null },
      id: { $gt: null },
    });
    assert.deepEqual(result, [
      {
        database: 'loyalty-ledger',
        designDocument: LOYALTY_LEDGER_INDEX_DDOC,
        index: LOYALTY_LEDGER_INDEX_NAME,
        outcome: 'created',
      },
      {
        database: 'checkouts',
        designDocument: CHECKOUT_LOYALTY_DUE_INDEX_DDOC,
        index: CHECKOUT_LOYALTY_DUE_INDEX_NAME,
        outcome: 'created',
      },
    ]);
  });

  it('accepts existing indexes and still verifies both', async () => {
    const ctx = migration(successfulResponses('exists'));

    const result = await migrateLoyaltyDatabases(ctx.input);

    assert.deepEqual(
      result.map(({ outcome }) => outcome),
      ['exists', 'exists']
    );
    assert.equal(cloudantCalls(ctx.calls).length, 4);
  });

  it('fails closed on a malformed create response', async () => {
    const ctx = migration([
      response(200, {
        result: 'created',
        id: '_design/wrong',
        name: LOYALTY_LEDGER_INDEX_NAME,
      }),
    ]);

    await assert.rejects(migrateLoyaltyDatabases(ctx.input), /invalid response/);
  });

  it('fails when creation or verification fails or has no docs array', async () => {
    const createFailure = migration([response(503, {})]);
    await assert.rejects(migrateLoyaltyDatabases(createFailure.input), /creation.*503/);

    const verifyFailure = migration([
      response(200, {
        result: 'created',
        id: `_design/${LOYALTY_LEDGER_INDEX_DDOC}`,
        name: LOYALTY_LEDGER_INDEX_NAME,
      }),
      response(400, {}),
    ]);
    await assert.rejects(migrateLoyaltyDatabases(verifyFailure.input), /verification.*400/);

    const malformedVerify = migration([
      response(200, {
        result: 'created',
        id: `_design/${LOYALTY_LEDGER_INDEX_DDOC}`,
        name: LOYALTY_LEDGER_INDEX_NAME,
      }),
      response(200, {}),
    ]);
    await assert.rejects(migrateLoyaltyDatabases(malformedVerify.input), /no docs array/);
  });

  it('rejects invalid database labels before a request', async () => {
    const ctx = migration(successfulResponses());

    await assert.rejects(
      migrateLoyaltyDatabases({ ...ctx.input, ledgerDatabase: 'bad\ndatabase' }),
      /database name/
    );
    assert.equal(ctx.calls.length, 0);
  });
});
