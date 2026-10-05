import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CloudantChangesFollower } from './cloudant-changes.ts';
import { createCloudantFake } from './cloudant-fake.mjs';
import { CloudantStore } from './cloudant-store.ts';

function followerWithFake() {
  const cloudant = createCloudantFake({ database: 'checkouts' });
  const store = new CloudantStore(
    { url: cloudant.url, apiKey: 'test-key', database: cloudant.database },
    cloudant.fetchImpl
  );
  return { cloudant, follower: new CloudantChangesFollower(store, cloudant.database) };
}

describe('CloudantChangesFollower', () => {
  it('pages with opaque checkpoints and filters non-checkout documents', async () => {
    const { cloudant, follower } = followerWithFake();
    cloudant.seed({ id: 'checkout-1', kind: 'checkout' });
    cloudant.seed({ id: 'claim-1', kind: 'checkout-idempotency-claim' });
    cloudant.seed({ id: 'checkout-2', kind: 'checkout' });

    const first = await follower.poll('0', 1);
    assert.deepEqual(
      first.changes.map(({ id }) => id),
      ['checkout-1']
    );
    assert.match(String(first.lastSeq), /^seq-/);

    const second = await follower.poll(first.lastSeq, 10);
    assert.deepEqual(
      second.changes.map(({ id }) => id),
      ['checkout-2']
    );
    assert.notDeepEqual(
      second.lastSeq,
      first.lastSeq,
      'filtered rows still advance the checkpoint'
    );
  });

  it('wakes a lazy long poll and aborts it when the final subscriber leaves', async () => {
    const { cloudant, follower } = followerWithFake();
    const received = [];
    const unsubscribe = follower.subscribe((change) => received.push(change));
    await new Promise((resolve) => setTimeout(resolve, 0));

    cloudant.seed({ id: 'checkout-1', kind: 'checkout' });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.deepEqual(
      received.map(({ id }) => id),
      ['checkout-1']
    );

    unsubscribe();
    await new Promise((resolve) => setTimeout(resolve, 0));
    const callsAfterStop = cloudant.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 10));
    assert.equal(cloudant.calls.length, callsAfterStop);
  });

  it('rejects invalid limits without touching Cloudant', async () => {
    const { cloudant, follower } = followerWithFake();
    await assert.rejects(follower.poll('0', 0), /limit/);
    assert.equal(cloudant.calls.length, 0);
  });
});
