import {
  CustomerProfileCorruptionError,
  CustomerProfileStore,
  samePendingAward,
  type DurableCustomerIdentity,
  type PendingLoyaltyAward,
  type VersionedCustomerProfile,
} from './customer-profile-store.ts';
import {
  ledgerEntryMatchesAward,
  LoyaltyLedgerCorruptionError,
  LoyaltyLedgerStore,
  type LoyaltyLedgerEntryDocument,
} from './loyalty-ledger-store.ts';
import {
  pointsForSelfCheckout,
  SELF_CHECKOUT_LOYALTY_POLICY_VERSION,
  type LoyaltyTier,
  type SelfCheckoutLoyaltyPolicyVersion,
} from './loyalty-policy.ts';

export interface LoyaltySettlementInput {
  readonly identity: DurableCustomerIdentity;
  readonly checkoutId: string;
  readonly transactionId: string;
  readonly storeId: string;
  readonly currency: 'USD';
  readonly totalMinorUnits: number;
}

/**
 * A checkout-owned loyalty lease must be revalidated immediately before every
 * cross-document mutation. The reconciliation adapter supplies this hook; direct
 * callers can omit it when no checkout projection is being coordinated.
 */
export interface LoyaltySettlementFence {
  beforeMutation(): Promise<void>;
}

export type LoyaltySettlementResult =
  | {
      readonly outcome: 'awarded' | 'replay';
      readonly pointsEarned: number;
      readonly policyVersion: SelfCheckoutLoyaltyPolicyVersion;
      readonly balance: number;
      readonly tier: LoyaltyTier;
    }
  | {
      readonly outcome: 'busy' | 'rebuilding' | 'quarantined';
      readonly pointsEarned: number;
      readonly policyVersion: SelfCheckoutLoyaltyPolicyVersion;
    };

export class LoyaltySettlementCorruptionError extends Error {
  readonly code:
    | 'ledger-binding-conflict'
    | 'ledger-invalid-record'
    | 'profile-gap'
    | 'profile-binding-conflict';

  constructor(code: LoyaltySettlementCorruptionError['code']) {
    super(`Customer loyalty settlement is corrupt: ${code}.`);
    this.name = 'LoyaltySettlementCorruptionError';
    this.code = code;
  }
}

export type LoyaltyRebuildResult =
  | {
      readonly outcome: 'rebuilt' | 'replay';
      readonly balance: number;
      readonly tier: LoyaltyTier;
      readonly lastAppliedSequence: number;
    }
  | { readonly outcome: 'stale-generation' | 'not-rebuilding' }
  | { readonly outcome: 'quarantined'; readonly reason: 'invalid-history' | 'stale-history' };

export class CustomerLoyaltyService {
  private readonly profiles: CustomerProfileStore;
  private readonly ledger: LoyaltyLedgerStore;
  private readonly nowIso: () => string;

  constructor(profiles: CustomerProfileStore, ledger: LoyaltyLedgerStore, nowIso: () => string) {
    this.profiles = profiles;
    this.ledger = ledger;
    this.nowIso = nowIso;
  }

  async settle(
    input: LoyaltySettlementInput,
    fence?: LoyaltySettlementFence
  ): Promise<LoyaltySettlementResult> {
    const expected = expectedAward(input);
    let existingEntry: LoyaltyLedgerEntryDocument | null;
    try {
      existingEntry = await this.ledger.read(input.checkoutId);
    } catch (error) {
      if (!(error instanceof LoyaltyLedgerCorruptionError)) throw error;
      const existingProfile = await this.profiles.read(input.identity);
      if (existingProfile !== null) await this.quarantine(input.identity, fence);
      throw new LoyaltySettlementCorruptionError('ledger-invalid-record');
    }
    let profile = await this.profiles.read(input.identity);

    if (existingEntry !== null) {
      return this.resumeExisting(input, expected, existingEntry, profile, fence);
    }

    profile = await this.ensureProfileWithoutHistory(input.identity, profile, fence);
    if (profile.document.status !== 'active') {
      return unavailable(profile.document.status, expected.points);
    }

    if (expected.points === 0) {
      return projection('awarded', expected.points, profile);
    }

    await checkFence(fence);
    const reserved = await this.profiles.reserveAward(input.identity, expected, this.now());
    if (reserved.outcome === 'busy') return unavailable('busy', expected.points);
    if (reserved.outcome === 'unavailable') return unavailable(reserved.status, expected.points);

    await checkFence(fence);
    const persisted = await this.ledger.createOrReplay(input.identity, reserved.award);
    if (persisted.outcome !== 'created' && persisted.outcome !== 'replay') {
      await this.quarantine(input.identity, fence);
      throw new LoyaltySettlementCorruptionError(
        persisted.outcome === 'invalid-record' ? 'ledger-invalid-record' : 'ledger-binding-conflict'
      );
    }

    return this.finalize(input.identity, reserved.award, reserved.outcome === 'replay', fence);
  }

  async rebuild(
    identity: DurableCustomerIdentity,
    generation: number
  ): Promise<LoyaltyRebuildResult> {
    const profile = await this.profiles.read(identity);
    if (profile === null || profile.document.recoveryGeneration !== generation) {
      return { outcome: 'stale-generation' };
    }
    if (profile.document.status === 'active') {
      return {
        outcome: 'replay',
        balance: profile.document.pointsBalance,
        tier: profile.document.tier,
        lastAppliedSequence: profile.document.lastAppliedSequence,
      };
    }
    if (profile.document.status !== 'rebuilding') return { outcome: 'not-rebuilding' };

    let expectedSequence = 1;
    let pointsBalance = 0;
    let cursor:
      | Exclude<Awaited<ReturnType<LoyaltyLedgerStore['listByCustomer']>>['nextCursor'], null>
      | undefined;
    try {
      do {
        const page = await this.ledger.listByCustomer({
          customerKey: identity.customerKey,
          limit: 100,
          ...(cursor === undefined ? {} : { cursor }),
        });
        for (const entry of page.entries) {
          if (
            entry.customerKeyVersion !== identity.keyVersion ||
            entry.sequence !== expectedSequence ||
            entry.points !== pointsForSelfCheckout(entry.totalMinorUnits)
          ) {
            return this.quarantineInvalidRebuild(identity, generation, 'invalid-history');
          }
          pointsBalance += entry.points;
          if (!Number.isSafeInteger(pointsBalance)) {
            return this.quarantineInvalidRebuild(identity, generation, 'invalid-history');
          }
          expectedSequence += 1;
        }
        cursor = page.nextCursor ?? undefined;
      } while (cursor !== undefined);
    } catch (error) {
      if (!(error instanceof LoyaltyLedgerCorruptionError)) throw error;
      return this.quarantineInvalidRebuild(identity, generation, 'invalid-history');
    }

    const installed = await this.profiles.installRebuiltProfile(
      identity,
      generation,
      { pointsBalance, lastAppliedSequence: expectedSequence - 1 },
      this.now()
    );
    switch (installed.outcome) {
      case 'stale-generation':
        return { outcome: 'stale-generation' };
      case 'not-rebuilding':
        return { outcome: 'not-rebuilding' };
      case 'mismatch':
        return this.quarantineInvalidRebuild(identity, generation, 'stale-history');
    }
    return {
      outcome: installed.outcome === 'installed' ? 'rebuilt' : 'replay',
      balance: installed.profile.document.pointsBalance,
      tier: installed.profile.document.tier,
      lastAppliedSequence: installed.profile.document.lastAppliedSequence,
    };
  }

  private async quarantineInvalidRebuild(
    identity: DurableCustomerIdentity,
    generation: number,
    reason: 'invalid-history' | 'stale-history'
  ): Promise<LoyaltyRebuildResult> {
    const result = await this.profiles.quarantineRebuild(identity, generation, this.now());
    if (result.outcome === 'stale-generation') return { outcome: 'stale-generation' };
    if (result.outcome === 'not-rebuilding') return { outcome: 'not-rebuilding' };
    return { outcome: 'quarantined', reason };
  }

  private async resumeExisting(
    input: LoyaltySettlementInput,
    expected: ReturnType<typeof expectedAward>,
    entry: LoyaltyLedgerEntryDocument,
    profile: VersionedCustomerProfile | null,
    fence?: LoyaltySettlementFence
  ): Promise<LoyaltySettlementResult> {
    if (!ledgerEntryMatchesAward(entry, input.identity, expected)) {
      if (profile !== null) await this.quarantine(input.identity, fence);
      throw new LoyaltySettlementCorruptionError('ledger-binding-conflict');
    }
    if (profile === null) {
      await checkFence(fence);
      await this.profiles.createRebuilding(input.identity, this.now());
      return unavailable('rebuilding', expected.points);
    }
    if (profile.document.status !== 'active') {
      return unavailable(profile.document.status, expected.points);
    }
    if (profile.document.lastAppliedSequence >= entry.sequence) {
      if (
        profile.document.pendingAward !== null &&
        samePendingAward(profile.document.pendingAward, entry)
      ) {
        await this.quarantine(input.identity, fence);
        throw new LoyaltySettlementCorruptionError('profile-binding-conflict');
      }
      return projection('replay', entry.points, profile);
    }
    if (
      profile.document.lastAppliedSequence + 1 !== entry.sequence ||
      profile.document.pendingAward === null ||
      !samePendingAward(profile.document.pendingAward, entry)
    ) {
      await this.quarantine(input.identity, fence);
      throw new LoyaltySettlementCorruptionError('profile-gap');
    }
    return this.finalize(input.identity, entry, true, fence);
  }

  private async ensureProfileWithoutHistory(
    identity: DurableCustomerIdentity,
    profile: VersionedCustomerProfile | null,
    fence?: LoyaltySettlementFence
  ): Promise<VersionedCustomerProfile> {
    if (profile !== null) return profile;
    const history = await this.ledger.listByCustomer({
      customerKey: identity.customerKey,
      limit: 1,
    });
    await checkFence(fence);
    if (history.entries.length > 0) {
      return this.profiles.createRebuilding(identity, this.now());
    }
    return this.profiles.createActive(identity, this.now());
  }

  private async finalize(
    identity: DurableCustomerIdentity,
    award: PendingLoyaltyAward,
    replay: boolean,
    fence?: LoyaltySettlementFence
  ): Promise<LoyaltySettlementResult> {
    await checkFence(fence);
    const result = await this.profiles.finalizeAward(identity, award, this.now());
    if (result.outcome === 'gap' || result.outcome === 'mismatch') {
      await this.quarantine(identity, fence);
      throw new LoyaltySettlementCorruptionError(
        result.outcome === 'gap' ? 'profile-gap' : 'profile-binding-conflict'
      );
    }
    return projection(
      replay || result.outcome === 'replay' ? 'replay' : 'awarded',
      award.points,
      result.profile
    );
  }

  private async quarantine(
    identity: DurableCustomerIdentity,
    fence?: LoyaltySettlementFence
  ): Promise<void> {
    try {
      await checkFence(fence);
      await this.profiles.quarantine(identity, this.now());
    } catch (error) {
      if (!(error instanceof CustomerProfileCorruptionError)) throw error;
    }
  }

  private now(): string {
    const value = this.nowIso();
    const epoch = Date.parse(value);
    if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value) {
      throw new Error('nowIso returned an invalid timestamp.');
    }
    return value;
  }
}

async function checkFence(fence: LoyaltySettlementFence | undefined): Promise<void> {
  await fence?.beforeMutation();
}

function expectedAward(
  input: LoyaltySettlementInput
): Omit<PendingLoyaltyAward, 'sequence' | 'awardedAt'> {
  for (const [value, label] of [
    [input.checkoutId, 'checkoutId'],
    [input.transactionId, 'transactionId'],
    [input.storeId, 'storeId'],
  ] as const) {
    if (value.length < 1 || value.length > 500 || /[\x00-\x1f\x7f]/.test(value)) {
      throw new Error(`${label} is invalid.`);
    }
  }
  if (input.currency !== 'USD') throw new Error('currency is invalid.');
  return {
    checkoutId: input.checkoutId,
    transactionId: input.transactionId,
    storeId: input.storeId,
    currency: input.currency,
    totalMinorUnits: input.totalMinorUnits,
    points: pointsForSelfCheckout(input.totalMinorUnits),
    policyVersion: SELF_CHECKOUT_LOYALTY_POLICY_VERSION,
  };
}

function projection(
  outcome: 'awarded' | 'replay',
  pointsEarned: number,
  profile: VersionedCustomerProfile
): LoyaltySettlementResult {
  return {
    outcome,
    pointsEarned,
    policyVersion: SELF_CHECKOUT_LOYALTY_POLICY_VERSION,
    balance: profile.document.pointsBalance,
    tier: profile.document.tier,
  };
}

function unavailable(
  status: 'busy' | 'rebuilding' | 'quarantined',
  pointsEarned: number
): LoyaltySettlementResult {
  return {
    outcome: status,
    pointsEarned,
    policyVersion: SELF_CHECKOUT_LOYALTY_POLICY_VERSION,
  };
}
