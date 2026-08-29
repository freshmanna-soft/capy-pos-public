/**
 * `CloudantStore` against the shared port contract, and then against the things
 * that are Cloudant's alone.
 *
 * The first block is the whole point of `document-store-contract.mjs` being a
 * separate, exported suite: the same assertions that hold `MemoryStore` up now hold
 * this up too, so the store the 58 route tests run on and the store the deployed
 * service runs on are proven to answer `written`/`conflict` identically instead of
 * being assumed to. `cloudant-fake.mjs` explains what that does and does not show.
 *
 * The second block covers what no port-level suite can see, because it is below the
 * port: the IAM token exchange and its cache, design documents in `_all_docs`,
 * `_id`/`_rev` never crossing the boundary, and a 5xx being thrown rather than
 * flattened into `conflict`.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeDocumentStoreContract } from '../../shared/src/document-store-contract.mjs';
import { CloudantStore } from './cloudant-store.ts';
import { createCloudantFake } from './cloudant-fake.mjs';

const API_KEY = 'test-api-key';

/** A store wired to a fresh fake, plus the fake, for the tests that inspect traffic. */
function storeWithFake(overrides = {}) {
  const cloudant = createCloudantFake(overrides);
  const store = new CloudantStore(
    { url: cloudant.url, apiKey: API_KEY, database: cloudant.database },
    cloudant.fetchImpl,
    overrides.nowMs
  );
  return { store, cloudant };
}

describeDocumentStoreContract('CloudantStore', () => storeWithFake().store);

describe('CloudantStore over Cloudant HTTP', () => {
  it('exchanges the API key for a bearer token once and reuses it', async () => {
    const { store, cloudant } = storeWithFake();

    await store.list();
    await store.list();
    await store.read('doc-1');

    assert.equal(cloudant.tokenExchanges, 1, 'a token per request would rate-limit IAM, not Cloudant');
    const iam = cloudant.calls.filter((call) => call.url.startsWith('https://iam.cloud.ibm.com/'));
    assert.equal(iam.length, 1);
    assert.equal(iam[0].method, 'POST');
  });

  it('sends the token it obtained as a bearer on every document call', async () => {
    const { store, cloudant } = storeWithFake();

    await store.list();

    const documentCalls = cloudant.calls.filter((call) => !call.url.startsWith('https://iam.cloud.ibm.com/'));
    assert.ok(documentCalls.length > 0);
    for (const call of documentCalls) {
      assert.equal(call.headers['Authorization'], 'Bearer iam-access-token-1');
    }
  });

  it('re-exchanges once the cached token is inside the 60-second margin', async () => {
    // The margin is the whole point: a token accepted when the request was built and
    // expired when Cloudant read it shows up as a rare, unreproducible 401.
    let now = 1_000_000;
    const { store, cloudant } = storeWithFake({ expiresIn: 300, nowMs: () => now });

    await store.list();
    now += 239_000; // 239s in: still outside the margin (300 - 60 = 240s of life).
    await store.list();
    assert.equal(cloudant.tokenExchanges, 1);

    now += 2_000; // 241s in: inside it.
    await store.list();
    assert.equal(cloudant.tokenExchanges, 2);
  });

  it('leaves design documents out of the list', async () => {
    const { store, cloudant } = storeWithFake();
    cloudant.seed({ id: 'doc-1', label: 'Espresso' });
    cloudant.seedDesignDocument('by-category');

    assert.deepEqual(await store.list(), [{ id: 'doc-1', label: 'Espresso' }]);
  });

  it('never lets Cloudant _id/_rev cross the boundary', async () => {
    const { store, cloudant } = storeWithFake();
    cloudant.seed({ id: 'doc-1', label: 'Espresso' });

    const revision = await store.read('doc-1');
    assert.deepEqual(Object.keys(revision.document).sort(), ['id', 'label']);
    assert.deepEqual(Object.keys((await store.list())[0]).sort(), ['id', 'label']);
    // The token is handed over separately, so it is impossible to echo it back in a
    // response body by accident — `api.ts` never sees a document carrying its own rev.
    assert.equal(typeof revision.rev, 'string');
  });

  it('targets the configured database, url-encoded', async () => {
    const { store, cloudant } = storeWithFake({ database: 'my products' });

    await store.read('doc/1');

    const call = cloudant.calls.at(-1);
    assert.equal(call.url, `${cloudant.url}/my%20products/doc%2F1`);
  });

  it('throws on a 5xx rather than reporting it as a conflict', async () => {
    // `conflict` is a retry signal. A store that answered it for a broken instance
    // would turn one outage into an infinite compare-and-swap loop in `api.ts`.
    for (const [operation, run] of [
      ['list', (store) => store.list()],
      ['read', (store) => store.read('doc-1')],
      ['create', (store) => store.create({ id: 'doc-1' })],
      ['write', (store) => store.write({ id: 'doc-1' }, '1-0001')],
      ['remove', (store) => store.remove('doc-1', '1-0001')],
    ]) {
      const { store, cloudant } = storeWithFake();
      cloudant.failNextRequestWith(500);

      await assert.rejects(run(store), /500/, `${operation} must not swallow a 500`);
    }
  });

  it('throws when a document comes back with no revision', async () => {
    const { store } = (() => {
      const cloudant = createCloudantFake();
      const revless = async (target, init) => {
        const response = await cloudant.fetchImpl(target, init);
        if (String(target).includes('/doc-1')) {
          const body = await response.json();
          delete body._rev;
          return new Response(JSON.stringify(body), { status: response.status });
        }
        return response;
      };
      cloudant.seed({ id: 'doc-1', label: 'Espresso' });
      return {
        store: new CloudantStore({ url: cloudant.url, apiKey: API_KEY, database: cloudant.database }, revless),
      };
    })();

    await assert.rejects(store.read('doc-1'), /no _rev/);
  });
});
