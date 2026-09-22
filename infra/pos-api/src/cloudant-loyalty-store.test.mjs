import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CloudantStore } from './cloudant-store.ts';
import {
  CloudantDueLoyaltyReader,
  CloudantLoyaltyLedgerHistoryReader,
} from './cloudant-loyalty-store.ts';
import {
  CHECKOUT_LOYALTY_DUE_INDEX_DDOC,
  CHECKOUT_LOYALTY_DUE_INDEX_NAME,
  LOYALTY_LEDGER_INDEX_DDOC,
  LOYALTY_LEDGER_INDEX_NAME,
} from './loyalty-migration.ts';

const AS_OF = '2027-01-15T10:00:00.000Z';

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function context(database, body) {
  const calls = [];
  const fetchImpl = async (target, init = {}) => {
    const url = String(target);
    calls.push({ url, init });
    if (url === 'https://iam.cloud.ibm.com/identity/token') {
      return response(200, { access_token: 'token', expires_in: 3600 });
    }
    return response(200, body);
  };
  return {
    store: new CloudantStore(
      { url: 'https://cloudant.example', apiKey: 'key', database },
      fetchImpl
    ),
    calls,
  };
}

describe('Cloudant loyalty readers', () => {
  it('queries pending completed checkout obligations with the migration index', async () => {
    const { store, calls } = context('checkouts', {
      docs: [{ _id: 'checkout-1', loyalty: { status: 'pending', nextActionAt: AS_OF } }],
    });
    const reader = new CloudantDueLoyaltyReader(store);
    const page = await reader.listDueLoyalty({ asOf: AS_OF, limit: 10 });
    assert.deepEqual(page.checkouts, [{ id: 'checkout-1' }]);
    const query = JSON.parse(calls.at(-1).init.body);
    assert.deepEqual(query.use_index, [
      CHECKOUT_LOYALTY_DUE_INDEX_DDOC,
      CHECKOUT_LOYALTY_DUE_INDEX_NAME,
    ]);
    assert.equal(query.selector.state.$eq, 'completed');
    assert.equal(query.selector['loyalty.status'].$eq, 'pending');
    assert.equal(query.limit, 11);
  });

  it('queries customer ledger history with a stable sequence/id cursor', async () => {
    const { store, calls } = context('loyalty-ledger', { docs: [] });
    const reader = new CloudantLoyaltyLedgerHistoryReader(store);
    await reader.listByCustomer({
      customerKey: 'customer-key',
      limit: 10,
      cursor: { sequence: 3, entryId: 'entry-3' },
    });
    const query = JSON.parse(calls.at(-1).init.body);
    assert.deepEqual(query.use_index, [LOYALTY_LEDGER_INDEX_DDOC, LOYALTY_LEDGER_INDEX_NAME]);
    assert.deepEqual(query.sort, [{ sequence: 'asc' }, { id: 'asc' }]);
    assert.deepEqual(query.selector.$or, [
      { sequence: { $gt: 3 } },
      { sequence: { $eq: 3 }, id: { $gt: 'entry-3' } },
    ]);
  });
});
