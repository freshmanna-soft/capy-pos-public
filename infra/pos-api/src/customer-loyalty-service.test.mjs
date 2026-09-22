import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { MemoryStore } from '../../shared/src/document-store.ts';
import { CustomerProfileCorruptionError, CustomerProfileStore } from './customer-profile-store.ts';
import {
  LoyaltyLedgerCorruptionError,
  LoyaltyLedgerStore,
  MemoryLoyaltyLedgerHistoryReader,
  loyaltyLedgerEntryId,
} from './loyalty-ledger-store.ts';
import {
  CustomerLoyaltyService,
  LoyaltySettlementCorruptionError,
} from './customer-loyalty-service.ts';
import { LoyaltyTier, pointsForSelfCheckout, tierForLoyaltyBalance } from './loyalty-policy.ts';

const NOW = '2027-01-15T10:00:00.000Z';
const LATER = '2027-01-15T10:00:01.000Z';
const identity = Object.freeze({
  issuer: 'https://us-south.appid.cloud.ibm.com/oauth/v4/tenant',
  subject: 'subject-1',
  tenantId: 'default-tenant',
  customerKey: 'customer-key-1',
  keyVersion: 'sha256-v1',
});

function settlementInput(overrides = {}) {
  return {
    identity,
    checkoutId: 'checkout-1',
    transactionId: 'transaction-1',
    storeId: 'store-1',
    currency: 'USD',
    totalMinorUnits: 1_299,
    ...overrides,
  };
}

function setup({
  now = () => NOW,
  profileDocuments = new MemoryStore(),
  ledgerDocuments = new MemoryStore(),
} = {}) {
  const profiles = new CustomerProfileStore(profileDocuments);
  const ledger = new LoyaltyLedgerStore(
    ledgerDocuments,
    new MemoryLoyaltyLedgerHistoryReader(ledgerDocuments)
  );
  const service = new CustomerLoyaltyService(profiles, ledger, now);
  return { profileDocuments, ledgerDocuments, profiles, ledger, service };
}

describe('self-checkout loyalty policy v1', () => {
  it('earns ten points per whole tax-inclusive USD without tier-order dependence', () => {
    assert.equal(pointsForSelfCheckout(99), 0);
    assert.equal(pointsForSelfCheckout(100), 10);
    assert.equal(pointsForSelfCheckout(1_299), 120);
    assert.throws(() => pointsForSelfCheckout(-1), /non-negative safe integer/i);
  });

  it('derives the four exact tiers from finalized balance', () => {
    assert.equal(tierForLoyaltyBalance(0), LoyaltyTier.BRONZE);
    assert.equal(tierForLoyaltyBalance(999), LoyaltyTier.BRONZE);
    assert.equal(tierForLoyaltyBalance(1_000), LoyaltyTier.SILVER);
    assert.equal(tierForLoyaltyBalance(5_000), LoyaltyTier.GOLD);
    assert.equal(tierForLoyaltyBalance(10_000), LoyaltyTier.PLATINUM);
  });
});

describe('customer loyalty settlement', () => {
  it('creates one profile, deterministic ledger entry and finalized balance', async () => {
    const { service, profiles, ledgerDocuments } = setup();
    const result = await service.settle(settlementInput());
    assert.deepEqual(result, {
      outcome: 'awarded',
      pointsEarned: 120,
      policyVersion: 'self-checkout-usd-v1',
      balance: 120,
      tier: 'bronze',
    });
    assert.equal((await profiles.read(identity)).document.lastAppliedSequence, 1);
    const entries = await ledgerDocuments.list();
    assert.equal(entries.length, 1);
    assert.equal(entries[0].id, loyaltyLedgerEntryId('checkout-1'));
    assert.equal(entries[0].sequence, 1);
    assert.equal(entries[0].awardedAt, NOW);
  });

  it('replays exactly without another entry or another balance increment', async () => {
    const { service, profiles, ledgerDocuments } = setup();
    await service.settle(settlementInput());
    const replay = await service.settle(settlementInput());
    assert.equal(replay.outcome, 'replay');
    assert.equal(replay.balance, 120);
    assert.equal((await profiles.read(identity)).document.pointsBalance, 120);
    assert.equal((await ledgerDocuments.list()).length, 1);
  });

  it('recovers when profile finalization succeeded but the caller lost the response', async () => {
    let calls = 0;
    const { profiles, ledger, service } = setup({ now: () => (calls++ === 0 ? NOW : LATER) });
    const originalFinalize = profiles.finalizeAward.bind(profiles);
    let loseFirstResponse = true;
    profiles.finalizeAward = async (...args) => {
      const outcome = await originalFinalize(...args);
      if (loseFirstResponse) {
        loseFirstResponse = false;
        throw new Error('response lost after successful profile write');
      }
      return outcome;
    };

    await assert.rejects(service.settle(settlementInput()), /response lost/);
    const entryBefore = await ledger.read('checkout-1');
    const retry = await service.settle(settlementInput());
    const entryAfter = await ledger.read('checkout-1');
    assert.equal(retry.outcome, 'replay');
    assert.equal(retry.balance, 120);
    assert.equal((await profiles.read(identity)).document.lastAppliedSequence, 1);
    assert.equal(entryAfter.sequence, 1);
    assert.equal(entryAfter.awardedAt, entryBefore.awardedAt);
  });

  it('serializes two checkout awards into contiguous per-customer sequences', async () => {
    const { service, profiles, ledgerDocuments } = setup();
    const first = await service.settle(settlementInput());
    const second = await service.settle(
      settlementInput({
        checkoutId: 'checkout-2',
        transactionId: 'transaction-2',
        totalMinorUnits: 580,
      })
    );
    assert.equal(first.balance, 120);
    assert.equal(second.balance, 170);
    const stored = await profiles.read(identity);
    assert.equal(stored.document.lastAppliedSequence, 2);
    assert.equal(stored.document.pointsBalance, 170);
    assert.deepEqual((await ledgerDocuments.list()).map((entry) => entry.sequence).sort(), [1, 2]);
  });

  it('returns busy when a different checkout owns the one pending profile slot', async () => {
    const { profiles, service } = setup();
    await profiles.createActive(identity, NOW);
    await profiles.reserveAward(
      identity,
      {
        checkoutId: 'checkout-other',
        transactionId: 'transaction-other',
        storeId: 'store-1',
        currency: 'USD',
        totalMinorUnits: 200,
        points: 20,
        policyVersion: 'self-checkout-usd-v1',
      },
      NOW
    );
    const result = await service.settle(settlementInput());
    assert.equal(result.outcome, 'busy');
    assert.equal(
      (await profiles.read(identity)).document.pendingAward.checkoutId,
      'checkout-other'
    );
  });

  it('finalizes an authenticated sub-dollar sale with no zero-value ledger entry', async () => {
    const { service, profiles, ledgerDocuments } = setup();
    const result = await service.settle(settlementInput({ totalMinorUnits: 99 }));
    assert.deepEqual(result, {
      outcome: 'awarded',
      pointsEarned: 0,
      policyVersion: 'self-checkout-usd-v1',
      balance: 0,
      tier: 'bronze',
    });
    assert.equal((await profiles.read(identity)).document.lastAppliedSequence, 0);
    assert.equal((await ledgerDocuments.list()).length, 0);
  });

  it('fails closed and quarantines on a deterministic ledger binding collision', async () => {
    const { service, profiles } = setup();
    await service.settle(settlementInput());
    await assert.rejects(
      service.settle(settlementInput({ transactionId: 'different-transaction' })),
      (error) =>
        error instanceof LoyaltySettlementCorruptionError &&
        error.code === 'ledger-binding-conflict'
    );
    assert.equal((await profiles.read(identity)).document.status, 'quarantined');
  });

  it('creates a rebuilding profile instead of silently starting at zero when ledger history exists', async () => {
    const { profiles, ledger, service } = setup();
    const award = {
      checkoutId: 'checkout-1',
      transactionId: 'transaction-1',
      storeId: 'store-1',
      currency: 'USD',
      totalMinorUnits: 1_299,
      points: 120,
      policyVersion: 'self-checkout-usd-v1',
      sequence: 1,
      awardedAt: NOW,
    };
    assert.equal((await ledger.createOrReplay(identity, award)).outcome, 'created');
    const result = await service.settle(settlementInput());
    assert.equal(result.outcome, 'rebuilding');
    const profile = await profiles.read(identity);
    assert.equal(profile.document.status, 'rebuilding');
    assert.equal(profile.document.pointsBalance, 0);
  });

  it('quarantines a profile when an existing ledger sequence has a gap', async () => {
    const { profiles, ledger, service } = setup();
    await profiles.createActive(identity, NOW);
    await ledger.createOrReplay(identity, {
      checkoutId: 'checkout-1',
      transactionId: 'transaction-1',
      storeId: 'store-1',
      currency: 'USD',
      totalMinorUnits: 1_299,
      points: 120,
      policyVersion: 'self-checkout-usd-v1',
      sequence: 2,
      awardedAt: NOW,
    });
    await assert.rejects(
      service.settle(settlementInput()),
      (error) => error instanceof LoyaltySettlementCorruptionError && error.code === 'profile-gap'
    );
    assert.equal((await profiles.read(identity)).document.status, 'quarantined');
  });

  it('fails closed when the same customer key is bound to another identity tuple', async () => {
    const { profiles, service } = setup();
    await service.settle(settlementInput());
    const collision = { ...identity, subject: 'subject-other' };
    await assert.rejects(
      profiles.read(collision),
      (error) =>
        error instanceof CustomerProfileCorruptionError && error.code === 'identity-conflict'
    );
  });

  it('quarantines an existing profile when its deterministic ledger record is malformed', async () => {
    const profileDocuments = new MemoryStore();
    const ledgerDocuments = new MemoryStore([
      {
        id: loyaltyLedgerEntryId('checkout-1'),
        kind: 'loyalty-ledger-entry',
        schemaVersion: 1,
        customerKey: identity.customerKey,
      },
    ]);
    const { profiles, service } = setup({ profileDocuments, ledgerDocuments });
    await profiles.createActive(identity, NOW);
    await assert.rejects(
      service.settle(settlementInput()),
      (error) =>
        error instanceof LoyaltySettlementCorruptionError && error.code === 'ledger-invalid-record'
    );
    assert.equal((await profiles.read(identity)).document.status, 'quarantined');
  });

  it('serializes simultaneous checkout awards without duplicate or skipped sequences', async () => {
    const { service, profiles, ledgerDocuments } = setup();
    const [first, second] = await Promise.all([
      service.settle(settlementInput()),
      service.settle(
        settlementInput({
          checkoutId: 'checkout-2',
          transactionId: 'transaction-2',
          totalMinorUnits: 580,
        })
      ),
    ]);
    assert.deepEqual(new Set([first.outcome, second.outcome]), new Set(['awarded', 'busy']));
    const busyInput =
      first.outcome === 'busy'
        ? settlementInput()
        : settlementInput({
            checkoutId: 'checkout-2',
            transactionId: 'transaction-2',
            totalMinorUnits: 580,
          });
    const retry = await service.settle(busyInput);
    assert.equal(retry.outcome, 'awarded');
    const stored = await profiles.read(identity);
    assert.equal(stored.document.pointsBalance, 170);
    assert.equal(stored.document.lastAppliedSequence, 2);
    assert.deepEqual((await ledgerDocuments.list()).map((entry) => entry.sequence).sort(), [1, 2]);
  });

  it('rebuilds a missing profile from contiguous ledger history under one generation', async () => {
    const { profiles, ledger, service } = setup();
    await ledger.createOrReplay(identity, {
      checkoutId: 'checkout-1',
      transactionId: 'transaction-1',
      storeId: 'store-1',
      currency: 'USD',
      totalMinorUnits: 1_299,
      points: 120,
      policyVersion: 'self-checkout-usd-v1',
      sequence: 1,
      awardedAt: NOW,
    });
    await ledger.createOrReplay(identity, {
      checkoutId: 'checkout-2',
      transactionId: 'transaction-2',
      storeId: 'store-1',
      currency: 'USD',
      totalMinorUnits: 580,
      points: 50,
      policyVersion: 'self-checkout-usd-v1',
      sequence: 2,
      awardedAt: LATER,
    });
    const unavailable = await service.settle(settlementInput());
    assert.equal(unavailable.outcome, 'rebuilding');
    const generation = (await profiles.read(identity)).document.recoveryGeneration;
    const rebuilt = await service.rebuild(identity, generation);
    assert.deepEqual(rebuilt, {
      outcome: 'rebuilt',
      balance: 170,
      tier: 'bronze',
      lastAppliedSequence: 2,
    });
    const replay = await service.rebuild(identity, generation);
    assert.equal(replay.outcome, 'replay');
  });

  it('rejects a stale rebuild generation without overwriting the newer profile state', async () => {
    const { profiles, service } = setup();
    const rebuilding = await profiles.createRebuilding(identity, NOW);
    await profiles.markRebuilding(identity, LATER);
    const result = await service.rebuild(identity, rebuilding.document.recoveryGeneration);
    assert.equal(result.outcome, 'stale-generation');
    const current = await profiles.read(identity);
    assert.equal(current.document.status, 'rebuilding');
    assert.equal(current.document.recoveryGeneration, rebuilding.document.recoveryGeneration + 1);
  });

  it('quarantines rebuilds with a sequence gap instead of guessing a balance', async () => {
    const { profiles, ledger, service } = setup();
    const rebuilding = await profiles.createRebuilding(identity, NOW);
    await ledger.createOrReplay(identity, {
      checkoutId: 'checkout-2',
      transactionId: 'transaction-2',
      storeId: 'store-1',
      currency: 'USD',
      totalMinorUnits: 580,
      points: 50,
      policyVersion: 'self-checkout-usd-v1',
      sequence: 2,
      awardedAt: NOW,
    });
    const result = await service.rebuild(identity, rebuilding.document.recoveryGeneration);
    assert.deepEqual(result, { outcome: 'quarantined', reason: 'invalid-history' });
    assert.equal((await profiles.read(identity)).document.status, 'quarantined');
  });
});

describe('append-only ledger repository', () => {
  it('uses a deterministic base64url checkout-derived id', () => {
    assert.equal(
      loyaltyLedgerEntryId('checkout/with spaces'),
      'loyalty-earn:Y2hlY2tvdXQvd2l0aCBzcGFjZXM'
    );
  });

  it('accepts exact create replay and rejects mismatched replay', async () => {
    const { ledger } = setup();
    const award = {
      checkoutId: 'checkout-1',
      transactionId: 'transaction-1',
      storeId: 'store-1',
      currency: 'USD',
      totalMinorUnits: 200,
      points: 20,
      policyVersion: 'self-checkout-usd-v1',
      sequence: 1,
      awardedAt: NOW,
    };
    assert.equal((await ledger.createOrReplay(identity, award)).outcome, 'created');
    assert.equal((await ledger.createOrReplay(identity, award)).outcome, 'replay');
    assert.equal(
      (await ledger.createOrReplay(identity, { ...award, points: 21 })).outcome,
      'binding-conflict'
    );
  });

  it('translates malformed persisted entries to a typed corruption error', async () => {
    const ledgerDocuments = new MemoryStore([
      { id: loyaltyLedgerEntryId('checkout-1'), kind: 'loyalty-ledger-entry' },
    ]);
    const ledger = new LoyaltyLedgerStore(
      ledgerDocuments,
      new MemoryLoyaltyLedgerHistoryReader(ledgerDocuments)
    );
    await assert.rejects(
      ledger.read('checkout-1'),
      (error) => error instanceof LoyaltyLedgerCorruptionError && error.code === 'invalid-record'
    );
  });

  it('pages one customer in strict sequence order without crossing identities', async () => {
    const { ledger } = setup();
    const secondIdentity = { ...identity, customerKey: 'customer-key-2', subject: 'subject-2' };
    for (const [owner, checkoutId, sequence] of [
      [identity, 'checkout-2', 2],
      [identity, 'checkout-1', 1],
      [secondIdentity, 'checkout-x', 1],
    ]) {
      await ledger.createOrReplay(owner, {
        checkoutId,
        transactionId: `transaction-${checkoutId}`,
        storeId: 'store-1',
        currency: 'USD',
        totalMinorUnits: 100,
        points: 10,
        policyVersion: 'self-checkout-usd-v1',
        sequence,
        awardedAt: NOW,
      });
    }
    const first = await ledger.listByCustomer({ customerKey: identity.customerKey, limit: 1 });
    assert.equal(first.entries[0].sequence, 1);
    assert.ok(first.nextCursor);
    const second = await ledger.listByCustomer({
      customerKey: identity.customerKey,
      limit: 1,
      cursor: first.nextCursor,
    });
    assert.equal(second.entries[0].sequence, 2);
    assert.equal(second.nextCursor, null);
  });
});
