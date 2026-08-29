/**
 * `MemoryStore` against the contract, plus the two things that are its own.
 *
 * It is the reference implementation, so the contract suite is most of its test: if
 * the in-memory store and Cloudant did not agree on when a write is a conflict, the
 * 58 route tests in `infra/pos-api` — which all run on this store — would be
 * asserting behaviour the deployed service does not have.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { describeDocumentStoreContract } from './document-store-contract.mjs';
import { MemoryStore } from './document-store.ts';

describeDocumentStoreContract('MemoryStore', () => new MemoryStore());

describe('MemoryStore seeding', () => {
  it('makes the seed readable, with a revision a write is allowed to spend', async () => {
    const store = new MemoryStore([{ id: 'doc-1', label: 'Espresso', count: 5 }]);

    const revision = await store.read('doc-1');
    assert.deepEqual(revision?.document, { id: 'doc-1', label: 'Espresso', count: 5 });
    assert.equal(await store.write({ id: 'doc-1', label: 'Espresso', count: 4 }, revision.rev), 'written');
  });

  it('clones the seed, so the caller cannot edit the store through the array it passed', async () => {
    const seed = [{ id: 'doc-1', label: 'Espresso', count: 5 }];
    const store = new MemoryStore(seed);

    seed[0].count = 999;

    assert.deepEqual((await store.read('doc-1'))?.document, { id: 'doc-1', label: 'Espresso', count: 5 });
  });
});
