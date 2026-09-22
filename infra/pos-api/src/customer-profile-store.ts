import type { DocumentStore, StoredDocument } from '../../shared/src/document-store.ts';
import {
  isLoyaltyTier,
  LoyaltyTier,
  SELF_CHECKOUT_LOYALTY_POLICY_VERSION,
  tierForLoyaltyBalance,
  type SelfCheckoutLoyaltyPolicyVersion,
} from './loyalty-policy.ts';

export interface DurableCustomerIdentity {
  readonly issuer: string;
  readonly subject: string;
  readonly tenantId: string;
  readonly customerKey: string;
  readonly keyVersion: 'sha256-v1';
}

export interface PendingLoyaltyAward {
  readonly checkoutId: string;
  readonly transactionId: string;
  readonly storeId: string;
  readonly currency: 'USD';
  readonly totalMinorUnits: number;
  readonly points: number;
  readonly policyVersion: SelfCheckoutLoyaltyPolicyVersion;
  readonly sequence: number;
  readonly awardedAt: string;
}

export type CustomerProfileStatus = 'active' | 'rebuilding' | 'quarantined';

export interface CustomerProfileDocument extends StoredDocument {
  readonly kind: 'customer-loyalty-profile';
  readonly schemaVersion: 1;
  readonly identity: DurableCustomerIdentity;
  readonly status: CustomerProfileStatus;
  readonly pointsBalance: number;
  readonly tier: LoyaltyTier;
  readonly lastAppliedSequence: number;
  readonly pendingAward: PendingLoyaltyAward | null;
  readonly recoveryGeneration: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface VersionedCustomerProfile {
  readonly document: CustomerProfileDocument;
  readonly revision: string;
}

export type ReserveAwardResult =
  | {
      readonly outcome: 'reserved' | 'replay';
      readonly profile: VersionedCustomerProfile;
      readonly award: PendingLoyaltyAward;
    }
  | { readonly outcome: 'busy'; readonly checkoutId: string }
  | { readonly outcome: 'unavailable'; readonly status: Exclude<CustomerProfileStatus, 'active'> };

export type FinalizeAwardResult =
  | { readonly outcome: 'finalized'; readonly profile: VersionedCustomerProfile }
  | { readonly outcome: 'replay'; readonly profile: VersionedCustomerProfile }
  | { readonly outcome: 'gap' }
  | { readonly outcome: 'mismatch' };

export type InstallRebuiltProfileResult =
  | { readonly outcome: 'installed' | 'replay'; readonly profile: VersionedCustomerProfile }
  | { readonly outcome: 'stale-generation' | 'not-rebuilding' }
  | { readonly outcome: 'mismatch' };

export type QuarantineRebuildResult =
  | { readonly outcome: 'quarantined'; readonly profile: VersionedCustomerProfile }
  | { readonly outcome: 'stale-generation' | 'not-rebuilding' };

export class CustomerProfileCorruptionError extends Error {
  readonly code: 'invalid-record' | 'identity-conflict' | 'binding-conflict';

  constructor(code: CustomerProfileCorruptionError['code']) {
    super(`Customer loyalty profile is corrupt: ${code}.`);
    this.name = 'CustomerProfileCorruptionError';
    this.code = code;
  }
}

const MAX_CAS_ATTEMPTS = 8;

export class CustomerProfileStore {
  private readonly documents: DocumentStore<CustomerProfileDocument>;

  constructor(documents: DocumentStore<CustomerProfileDocument>) {
    this.documents = documents;
  }

  async read(identity: DurableCustomerIdentity): Promise<VersionedCustomerProfile | null> {
    assertIdentity(identity);
    const stored = await this.documents.read(identity.customerKey);
    if (stored === null) return null;
    try {
      assertCustomerProfile(stored.document);
    } catch {
      throw new CustomerProfileCorruptionError('invalid-record');
    }
    if (!sameIdentity(stored.document.identity, identity)) {
      throw new CustomerProfileCorruptionError('identity-conflict');
    }
    return { document: stored.document, revision: stored.rev };
  }

  /** Call only after the ledger history reader has proved this identity has no history. */
  async createActive(
    identity: DurableCustomerIdentity,
    nowIso: string
  ): Promise<VersionedCustomerProfile> {
    return this.create(identity, 'active', nowIso);
  }

  /** Used when history exists but its projection is absent; awards stay blocked until rebuild completes. */
  async createRebuilding(
    identity: DurableCustomerIdentity,
    nowIso: string
  ): Promise<VersionedCustomerProfile> {
    return this.create(identity, 'rebuilding', nowIso);
  }

  private async create(
    identity: DurableCustomerIdentity,
    status: 'active' | 'rebuilding',
    nowIso: string
  ): Promise<VersionedCustomerProfile> {
    assertIdentity(identity);
    assertCanonicalUtc(nowIso, 'nowIso');
    const profile: CustomerProfileDocument = {
      id: identity.customerKey,
      kind: 'customer-loyalty-profile',
      schemaVersion: 1,
      identity,
      status,
      pointsBalance: 0,
      tier: LoyaltyTier.BRONZE,
      lastAppliedSequence: 0,
      pendingAward: null,
      recoveryGeneration: status === 'rebuilding' ? 1 : 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    if ((await this.documents.create(profile)) === 'created') {
      return (await this.read(identity))!;
    }
    const replay = await this.read(identity);
    if (replay === null)
      throw new Error('Customer profile create conflict could not be reconciled.');
    return replay;
  }

  async reserveAward(
    identity: DurableCustomerIdentity,
    input: Omit<PendingLoyaltyAward, 'sequence' | 'awardedAt'>,
    nowIso: string
  ): Promise<ReserveAwardResult> {
    assertPendingInput(input);
    assertCanonicalUtc(nowIso, 'nowIso');
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.read(identity);
      if (current === null) throw new Error('Customer profile does not exist.');
      if (current.document.status !== 'active') {
        return { outcome: 'unavailable', status: current.document.status };
      }
      if (current.document.pendingAward !== null) {
        if (sameAwardInput(current.document.pendingAward, input)) {
          return {
            outcome: 'replay',
            profile: current,
            award: current.document.pendingAward,
          };
        }
        return { outcome: 'busy', checkoutId: current.document.pendingAward.checkoutId };
      }
      const award: PendingLoyaltyAward = {
        ...input,
        sequence: current.document.lastAppliedSequence + 1,
        awardedAt: nowIso,
      };
      const next: CustomerProfileDocument = {
        ...current.document,
        pendingAward: award,
        updatedAt: nowIso,
      };
      if ((await this.documents.write(next, current.revision)) === 'written') {
        return { outcome: 'reserved', profile: (await this.read(identity))!, award };
      }
    }
    throw new Error('Customer profile award reservation conflicted too many times.');
  }

  async finalizeAward(
    identity: DurableCustomerIdentity,
    award: PendingLoyaltyAward,
    nowIso: string
  ): Promise<FinalizeAwardResult> {
    assertPendingAward(award);
    assertCanonicalUtc(nowIso, 'nowIso');
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.read(identity);
      if (current === null) return { outcome: 'gap' };
      if (current.document.lastAppliedSequence >= award.sequence) {
        return current.document.lastAppliedSequence === award.sequence &&
          current.document.pendingAward === null
          ? { outcome: 'replay', profile: current }
          : { outcome: 'gap' };
      }
      if (current.document.lastAppliedSequence + 1 !== award.sequence) return { outcome: 'gap' };
      if (
        current.document.pendingAward === null ||
        !samePendingAward(current.document.pendingAward, award)
      ) {
        return { outcome: 'mismatch' };
      }
      const pointsBalance = current.document.pointsBalance + award.points;
      if (!Number.isSafeInteger(pointsBalance))
        throw new CustomerProfileCorruptionError('invalid-record');
      const next: CustomerProfileDocument = {
        ...current.document,
        pointsBalance,
        tier: tierForLoyaltyBalance(pointsBalance),
        lastAppliedSequence: award.sequence,
        pendingAward: null,
        updatedAt: nowIso,
      };
      if ((await this.documents.write(next, current.revision)) === 'written') {
        return { outcome: 'finalized', profile: (await this.read(identity))! };
      }
    }
    throw new Error('Customer profile award finalization conflicted too many times.');
  }

  async markRebuilding(
    identity: DurableCustomerIdentity,
    nowIso: string
  ): Promise<VersionedCustomerProfile> {
    return this.changeStatus(identity, 'rebuilding', nowIso, true);
  }

  async installRebuiltProfile(
    identity: DurableCustomerIdentity,
    generation: number,
    input: {
      readonly pointsBalance: number;
      readonly lastAppliedSequence: number;
    },
    nowIso: string
  ): Promise<InstallRebuiltProfileResult> {
    assertNonNegativeSafeInteger(generation, 'generation');
    assertNonNegativeSafeInteger(input.pointsBalance, 'pointsBalance');
    assertNonNegativeSafeInteger(input.lastAppliedSequence, 'lastAppliedSequence');
    assertCanonicalUtc(nowIso, 'nowIso');
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.read(identity);
      if (current === null) return { outcome: 'mismatch' };
      if (current.document.recoveryGeneration !== generation) {
        return { outcome: 'stale-generation' };
      }
      if (current.document.status === 'active') {
        return current.document.pointsBalance === input.pointsBalance &&
          current.document.lastAppliedSequence === input.lastAppliedSequence &&
          current.document.pendingAward === null
          ? { outcome: 'replay', profile: current }
          : { outcome: 'mismatch' };
      }
      if (current.document.status !== 'rebuilding') return { outcome: 'not-rebuilding' };
      if (current.document.pendingAward !== null) return { outcome: 'mismatch' };
      const next: CustomerProfileDocument = {
        ...current.document,
        status: 'active',
        pointsBalance: input.pointsBalance,
        tier: tierForLoyaltyBalance(input.pointsBalance),
        lastAppliedSequence: input.lastAppliedSequence,
        updatedAt: nowIso,
      };
      if ((await this.documents.write(next, current.revision)) === 'written') {
        return { outcome: 'installed', profile: (await this.read(identity))! };
      }
    }
    throw new Error('Customer profile rebuild installation conflicted too many times.');
  }

  async quarantineRebuild(
    identity: DurableCustomerIdentity,
    generation: number,
    nowIso: string
  ): Promise<QuarantineRebuildResult> {
    assertNonNegativeSafeInteger(generation, 'generation');
    assertCanonicalUtc(nowIso, 'nowIso');
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.read(identity);
      if (current === null || current.document.recoveryGeneration !== generation) {
        return { outcome: 'stale-generation' };
      }
      if (current.document.status !== 'rebuilding') return { outcome: 'not-rebuilding' };
      const next: CustomerProfileDocument = {
        ...current.document,
        status: 'quarantined',
        updatedAt: nowIso,
      };
      if ((await this.documents.write(next, current.revision)) === 'written') {
        return { outcome: 'quarantined', profile: (await this.read(identity))! };
      }
    }
    throw new Error('Customer profile rebuild quarantine conflicted too many times.');
  }

  async quarantine(
    identity: DurableCustomerIdentity,
    nowIso: string
  ): Promise<VersionedCustomerProfile> {
    return this.changeStatus(identity, 'quarantined', nowIso, false);
  }

  private async changeStatus(
    identity: DurableCustomerIdentity,
    status: Exclude<CustomerProfileStatus, 'active'>,
    nowIso: string,
    incrementGeneration: boolean
  ): Promise<VersionedCustomerProfile> {
    assertCanonicalUtc(nowIso, 'nowIso');
    for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt += 1) {
      const current = await this.read(identity);
      if (current === null) throw new Error('Customer profile does not exist.');
      if (current.document.status === status && !incrementGeneration) return current;
      const next: CustomerProfileDocument = {
        ...current.document,
        status,
        recoveryGeneration: current.document.recoveryGeneration + (incrementGeneration ? 1 : 0),
        updatedAt: nowIso,
      };
      if ((await this.documents.write(next, current.revision)) === 'written') {
        return (await this.read(identity))!;
      }
    }
    throw new Error('Customer profile status change conflicted too many times.');
  }
}

export function samePendingAward(left: PendingLoyaltyAward, right: PendingLoyaltyAward): boolean {
  return (
    left.checkoutId === right.checkoutId &&
    left.transactionId === right.transactionId &&
    left.storeId === right.storeId &&
    left.currency === right.currency &&
    left.totalMinorUnits === right.totalMinorUnits &&
    left.points === right.points &&
    left.policyVersion === right.policyVersion &&
    left.sequence === right.sequence &&
    left.awardedAt === right.awardedAt
  );
}

function sameAwardInput(
  pending: PendingLoyaltyAward,
  input: Omit<PendingLoyaltyAward, 'sequence' | 'awardedAt'>
): boolean {
  return (
    pending.checkoutId === input.checkoutId &&
    pending.transactionId === input.transactionId &&
    pending.storeId === input.storeId &&
    pending.currency === input.currency &&
    pending.totalMinorUnits === input.totalMinorUnits &&
    pending.points === input.points &&
    pending.policyVersion === input.policyVersion
  );
}

function assertCustomerProfile(value: unknown): asserts value is CustomerProfileDocument {
  const profile = exactRecord(
    value,
    [
      'id',
      'kind',
      'schemaVersion',
      'identity',
      'status',
      'pointsBalance',
      'tier',
      'lastAppliedSequence',
      'pendingAward',
      'recoveryGeneration',
      'createdAt',
      'updatedAt',
    ],
    'customer profile'
  );
  if (profile['kind'] !== 'customer-loyalty-profile' || profile['schemaVersion'] !== 1) {
    throw new Error('Invalid customer profile kind or schema.');
  }
  assertIdentity(profile['identity']);
  if (profile['id'] !== profile['identity'].customerKey)
    throw new Error('Profile id differs from customer key.');
  if (!['active', 'rebuilding', 'quarantined'].includes(String(profile['status']))) {
    throw new Error('Invalid profile status.');
  }
  assertNonNegativeSafeInteger(profile['pointsBalance'], 'pointsBalance');
  if (
    !isLoyaltyTier(profile['tier']) ||
    profile['tier'] !== tierForLoyaltyBalance(profile['pointsBalance'])
  ) {
    throw new Error('Invalid profile tier.');
  }
  assertNonNegativeSafeInteger(profile['lastAppliedSequence'], 'lastAppliedSequence');
  assertNonNegativeSafeInteger(profile['recoveryGeneration'], 'recoveryGeneration');
  if (profile['pendingAward'] !== null) {
    assertPendingAward(profile['pendingAward']);
    if (profile['pendingAward'].sequence !== profile['lastAppliedSequence'] + 1) {
      throw new Error('Pending sequence is not contiguous.');
    }
  }
  const created = assertCanonicalUtc(profile['createdAt'], 'createdAt');
  const updated = assertCanonicalUtc(profile['updatedAt'], 'updatedAt');
  if (updated < created) throw new Error('Profile timestamps are out of order.');
}

export function assertIdentity(value: unknown): asserts value is DurableCustomerIdentity {
  const identity = exactRecord(
    value,
    ['issuer', 'subject', 'tenantId', 'customerKey', 'keyVersion'],
    'customer identity'
  );
  for (const field of ['issuer', 'subject', 'tenantId', 'customerKey'] as const) {
    assertIdentifier(identity[field], field);
  }
  if (identity['keyVersion'] !== 'sha256-v1') throw new Error('Invalid customer key version.');
}

export function assertPendingAward(value: unknown): asserts value is PendingLoyaltyAward {
  const award = exactRecord(
    value,
    [
      'checkoutId',
      'transactionId',
      'storeId',
      'currency',
      'totalMinorUnits',
      'points',
      'policyVersion',
      'sequence',
      'awardedAt',
    ],
    'pending award'
  );
  assertPendingInput(award);
  assertPositiveSafeInteger(award['sequence'], 'sequence');
  assertCanonicalUtc(award['awardedAt'], 'awardedAt');
}

function assertPendingInput(value: unknown): void {
  if (!isRecord(value)) throw new Error('Award input must be an object.');
  for (const field of ['checkoutId', 'transactionId', 'storeId'] as const) {
    assertIdentifier(value[field], field);
  }
  if (value['currency'] !== 'USD') throw new Error('Invalid award currency.');
  assertNonNegativeSafeInteger(value['totalMinorUnits'], 'totalMinorUnits');
  assertNonNegativeSafeInteger(value['points'], 'points');
  if (value['policyVersion'] !== SELF_CHECKOUT_LOYALTY_POLICY_VERSION) {
    throw new Error('Invalid loyalty policy version.');
  }
}

function sameIdentity(left: DurableCustomerIdentity, right: DurableCustomerIdentity): boolean {
  return (
    left.issuer === right.issuer &&
    left.subject === right.subject &&
    left.tenantId === right.tenantId &&
    left.customerKey === right.customerKey &&
    left.keyVersion === right.keyVersion
  );
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  label: string
): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value);
  if (actual.length !== keys.length || actual.some((key) => !keys.includes(key))) {
    throw new Error(`${label} has an invalid shape.`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function assertIdentifier(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 500 ||
    /[\x00-\x1f\x7f]/.test(value)
  ) {
    throw new Error(`${label} is invalid.`);
  }
}

function assertNonNegativeSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 0)
    throw new Error(`${label} is invalid.`);
}

function assertPositiveSafeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isSafeInteger(value) || (value as number) < 1)
    throw new Error(`${label} is invalid.`);
}

function assertCanonicalUtc(value: unknown, label: string): number {
  if (typeof value !== 'string') throw new Error(`${label} is invalid.`);
  const epoch = Date.parse(value);
  if (!Number.isFinite(epoch) || new Date(epoch).toISOString() !== value)
    throw new Error(`${label} is invalid.`);
  return epoch;
}
