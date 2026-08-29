/**
 * The `DocumentStore` contract, as an executable suite.
 *
 * README.md states in prose what an implementation must guarantee; this states the
 * same thing in assertions, so a new backend (Firestore, DynamoDB, Postgres) finds
 * out whether it actually honours the port instead of being reviewed against a
 * paragraph. Every implementation is expected to call it:
 *
 *   import { describeDocumentStoreContract } from '…/document-store-contract.mjs';
 *   describeDocumentStoreContract('FirestoreStore', () => new FirestoreStore(fake));
 *
 * The factory hands back an *empty* store; the suite seeds through `create` rather
 * than through a constructor, because a seed argument is `MemoryStore`'s convenience
 * and not part of the port. It is `async`-tolerant so an implementation that has to
 * provision a container or truncate a collection can do it per test.
 *
 * The suite deliberately never asserts what a revision token *looks like* — only
 * that a fresh one is accepted and a stale one is refused. `MemoryStore` uses a
 * counter and Cloudant uses `1-9f2…`; a suite that read either shape would pass for
 * the wrong reason and would fail the next backend for no reason.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';

/** Two documents, distinguishable, with nothing in them but `StoredDocument`'s `id` plus payload. */
const FIRST = { id: 'doc-1', label: 'Espresso', count: 5 };
const SECOND = { id: 'doc-2', label: 'Cortado', count: 2 };

/**
 * @param {string} name How the implementation should be named in test output.
 * @param {() => Promise<object> | object} createStore Hands back a fresh, empty store.
 */
export function describeDocumentStoreContract(name, createStore) {
  describe(`DocumentStore contract — ${name}`, () => {
    let store;

    beforeEach(async () => {
      store = await createStore();
    });

    it('starts empty: nothing to list, and an unknown id reads as null', async () => {
      assert.deepEqual(await store.list(), []);
      assert.equal(await store.read('doc-1'), null);
    });

    it('creates a document that both read and list hand back', async () => {
      assert.equal(await store.create(FIRST), 'created');

      const revision = await store.read('doc-1');
      assert.deepEqual(revision?.document, FIRST);
      assert.deepEqual(await store.list(), [FIRST]);
    });

    it('lists every document, not just the newest', async () => {
      await store.create(FIRST);
      await store.create(SECOND);

      const listed = await store.list();
      assert.deepEqual(
        [...listed].sort((a, b) => a.id.localeCompare(b.id)),
        [FIRST, SECOND]
      );
    });

    it('hands out a non-empty revision token with every read', async () => {
      await store.create(FIRST);

      const revision = await store.read('doc-1');
      assert.equal(typeof revision?.rev, 'string');
      assert.ok((revision?.rev ?? '').length > 0, 'a revision token must be something the caller can send back');
    });

    it('refuses a duplicate id as a conflict, and leaves the stored document alone', async () => {
      await store.create(FIRST);

      assert.equal(await store.create({ ...FIRST, label: 'Overwritten' }), 'conflict');

      const revision = await store.read('doc-1');
      assert.deepEqual(revision?.document, FIRST, 'a refused create must not be a partial write');
    });

    it('writes with the current revision, and issues a different one', async () => {
      await store.create(FIRST);
      const before = await store.read('doc-1');

      assert.equal(await store.write({ ...FIRST, count: 4 }, before.rev), 'written');

      const after = await store.read('doc-1');
      assert.deepEqual(after?.document, { ...FIRST, count: 4 });
      assert.notEqual(after?.rev, before.rev, 'the token that was just spent must not still be valid');
    });

    it('refuses a stale revision as a conflict, and changes nothing', async () => {
      await store.create(FIRST);
      const stale = await store.read('doc-1');
      await store.write({ ...FIRST, count: 4 }, stale.rev);

      assert.equal(await store.write({ ...FIRST, count: 99 }, stale.rev), 'conflict');

      const current = await store.read('doc-1');
      assert.deepEqual(current?.document, { ...FIRST, count: 4 }, 'the losing write must not land');
    });

    it('treats a write to an id that does not exist as a conflict', async () => {
      assert.equal(await store.write(FIRST, 'any-token'), 'conflict');
      assert.equal(await store.read('doc-1'), null, 'a conflict must never create the document');
    });

    it('removes with the current revision', async () => {
      await store.create(FIRST);
      await store.create(SECOND);
      const revision = await store.read('doc-1');

      assert.equal(await store.remove('doc-1', revision.rev), 'written');

      assert.equal(await store.read('doc-1'), null);
      assert.deepEqual(await store.list(), [SECOND]);
    });

    it('refuses a remove carrying a stale revision, and keeps the document', async () => {
      await store.create(FIRST);
      const stale = await store.read('doc-1');
      await store.write({ ...FIRST, count: 4 }, stale.rev);

      assert.equal(await store.remove('doc-1', stale.rev), 'conflict');

      assert.deepEqual((await store.read('doc-1'))?.document, { ...FIRST, count: 4 });
    });

    it('treats a remove of an unknown id as a conflict', async () => {
      assert.equal(await store.remove('doc-1', 'any-token'), 'conflict');
    });

    it('hands out copies: editing what came back does not edit the store', async () => {
      await store.create(FIRST);

      const revision = await store.read('doc-1');
      revision.document.count = 999;
      const [listed] = await store.list();
      listed.count = 998;

      assert.deepEqual((await store.read('doc-1'))?.document, FIRST);
    });

    it('means "someone else wrote first", never "the write was invalid": the retry lands', async () => {
      // The compare-and-swap `api.ts` runs on every sell. A conflict is only ever a
      // signal to re-read and try again — if an implementation returned it for a bad
      // document instead, that retry loop would spin until it gave up.
      await store.create(FIRST);
      const stale = await store.read('doc-1');
      await store.write({ ...FIRST, count: 4 }, stale.rev);

      assert.equal(await store.write({ ...FIRST, count: 3 }, stale.rev), 'conflict');
      const fresh = await store.read('doc-1');
      assert.equal(await store.write({ ...FIRST, count: 3 }, fresh.rev), 'written');
      assert.deepEqual((await store.read('doc-1'))?.document, { ...FIRST, count: 3 });
    });
  });
}
