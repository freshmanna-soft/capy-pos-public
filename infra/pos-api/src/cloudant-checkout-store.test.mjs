import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CloudantStore } from './cloudant-store.ts';
import {
  CHECKOUT_DUE_INDEX_DDOC,
  CHECKOUT_DUE_INDEX_NAME,
  CloudantDueCheckoutReader,
} from './cloudant-checkout-store.ts';

const AS_OF = '2027-01-15T10:00:00.000Z';

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function readerWithResponse(status, body) {
  const calls = [];
  const fetchImpl = async (target, init = {}) => {
    const url = String(target);
    calls.push({ url, init });
    if (url === 'https://iam.cloud.ibm.com/identity/token') {
      return response(200, { access_token: 'token', expires_in: 3600 });
    }
    return response(status, body);
  };
  const store = new CloudantStore(
    { url: 'https://cloudant.example', apiKey: 'key', database: 'checkouts' },
    fetchImpl
  );
  return { reader: new CloudantDueCheckoutReader(store), calls };
}

function dueDocument(id, nextActionAt) {
  return { _id: id, kind: 'checkout', nextActionAt };
}

describe('CloudantDueCheckoutReader', () => {
  it('uses the required index and bounds loaded rows to one look-ahead document', async () => {
    const { reader, calls } = readerWithResponse(200, {
      docs: [
        dueDocument('checkout-1', '2027-01-15T09:00:00.000Z'),
        dueDocument('checkout-2', '2027-01-15T09:01:00.000Z'),
      ],
    });
    const page = await reader.listDue({ asOf: AS_OF, limit: 1 });
    const find = calls.at(-1);
    assert.equal(find.url, 'https://cloudant.example/checkouts/_find');
    const body = JSON.parse(find.init.body);
    assert.equal(body.limit, 2);
    assert.deepEqual(body.use_index, [CHECKOUT_DUE_INDEX_DDOC, CHECKOUT_DUE_INDEX_NAME]);
    assert.deepEqual(body.sort, [{ nextActionAt: 'asc' }, { id: 'asc' }]);
    assert.equal(page.checkouts.length, 1);
    assert.deepEqual(page.nextCursor, {
      asOf: AS_OF,
      nextActionAt: '2027-01-15T09:00:00.000Z',
      checkoutId: 'checkout-1',
    });
  });

  it('uses a stable tuple cursor rather than skip-based pagination', async () => {
    const { reader, calls } = readerWithResponse(200, { docs: [] });
    await reader.listDue({
      asOf: AS_OF,
      limit: 20,
      cursor: {
        asOf: AS_OF,
        nextActionAt: '2027-01-15T09:00:00.000Z',
        checkoutId: 'checkout-1',
      },
    });
    const body = JSON.parse(calls.at(-1).init.body);
    assert.equal(body.skip, undefined);
    assert.deepEqual(body.selector.$or, [
      { nextActionAt: { $gt: '2027-01-15T09:00:00.000Z' } },
      {
        nextActionAt: { $eq: '2027-01-15T09:00:00.000Z' },
        id: { $gt: 'checkout-1' },
      },
    ]);
  });

  it('fails closed with the required index name when Cloudant rejects the query', async () => {
    const { reader } = readerWithResponse(400, { error: 'no_usable_index' });
    await assert.rejects(
      reader.listDue({ asOf: AS_OF, limit: 20 }),
      new RegExp(`${CHECKOUT_DUE_INDEX_DDOC}/${CHECKOUT_DUE_INDEX_NAME}`)
    );
  });

  it('rejects unbounded limits before making a Cloudant request', async () => {
    const { reader, calls } = readerWithResponse(200, { docs: [] });
    await assert.rejects(reader.listDue({ asOf: AS_OF, limit: 101 }), /limit/);
    assert.equal(calls.length, 0);
  });
});
