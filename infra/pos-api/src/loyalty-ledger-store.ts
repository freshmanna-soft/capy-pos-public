import type { DocumentStore, StoredDocument } from '../../shared/src/document-store.ts';
import {
  assertIdentity,
  assertPendingAward,
  samePendingAward,
  type DurableCustomerIdentity,
  type PendingLoyaltyAward,
} from './customer-profile-store.ts';

export interface LoyaltyLedgerEntryDocument extends StoredDocument, PendingLoyaltyAward {
  readonly kind: 'loyalty-ledger-entry';
  readonly schemaVersion: 1;
  readonly customerKey: string;
  readonly customerKeyVersion: DurableCustomerIdentity['keyVersion'];
}

export interface LoyaltyLedgerCursor {
  readonly sequence: number;
  readonly entryId: string;
}

export interface LoyaltyLedgerPage {
  readonly entries: readonly LoyaltyLedgerEntryDocument[];
  readonly nextCursor: LoyaltyLedgerCursor | null;
}

export interface LoyaltyLedgerHistoryReader {
  listByCustomer(input: {
    readonly customerKey: string;
    readonly limit: number;
    readonly cursor?: LoyaltyLedgerCursor;
  }): Promise<LoyaltyLedgerPage>;
}

export type LedgerCreateResult =
  | { readonly outcome: 'created' | 'replay'; readonly entry: LoyaltyLedgerEntryDocument }
  | { readonly outcome: 'binding-conflict' | 'invalid-record' };

export class LoyaltyLedgerCorruptionError extends Error {
  readonly code: 'invalid-record';

  constructor(code: LoyaltyLedgerCorruptionError['code']) {
    super(`Loyalty ledger is corrupt: ${code}.`);
    this.name = 'LoyaltyLedgerCorruptionError';
    this.code = code;
  }
}

const MAX_PAGE_SIZE = 100;
const LEDGER_PREFIX = 'loyalty-earn:';

/** Business-facing append-only repository: no generic write or remove surface. */
export class LoyaltyLedgerStore {
  private readonly documents: Pick<DocumentStore<LoyaltyLedgerEntryDocument>, 'create' | 'read'>;
  private readonly history: LoyaltyLedgerHistoryReader;

  constructor(
    documents: Pick<DocumentStore<LoyaltyLedgerEntryDocument>, 'create' | 'read'>,
    history: LoyaltyLedgerHistoryReader
  ) {
    this.documents = documents;
    this.history = history;
  }

  async read(checkoutId: string): Promise<LoyaltyLedgerEntryDocument | null> {
    const stored = await this.documents.read(loyaltyLedgerEntryId(checkoutId));
    if (stored === null) return null;
    try {
      assertLedgerEntry(stored.document);
    } catch {
      throw new LoyaltyLedgerCorruptionError('invalid-record');
    }
    return stored.document;
  }

  async createOrReplay(
    identity: DurableCustomerIdentity,
    award: PendingLoyaltyAward
  ): Promise<LedgerCreateResult> {
    assertIdentity(identity);
    assertPendingAward(award);
    const entry: LoyaltyLedgerEntryDocument = {
      id: loyaltyLedgerEntryId(award.checkoutId),
      kind: 'loyalty-ledger-entry',
      schemaVersion: 1,
      customerKey: identity.customerKey,
      customerKeyVersion: identity.keyVersion,
      ...award,
    };
    if ((await this.documents.create(entry)) === 'created') return { outcome: 'created', entry };
    const existing = await this.documents.read(entry.id);
    if (existing === null) throw new Error('Loyalty ledger conflict could not be reconciled.');
    try {
      assertLedgerEntry(existing.document);
    } catch {
      return { outcome: 'invalid-record' };
    }
    if (!sameLedgerEntry(existing.document, entry)) return { outcome: 'binding-conflict' };
    return { outcome: 'replay', entry: existing.document };
  }

  async listByCustomer(input: {
    readonly customerKey: string;
    readonly limit: number;
    readonly cursor?: LoyaltyLedgerCursor;
  }): Promise<LoyaltyLedgerPage> {
    assertIdentifier(input.customerKey, 'customerKey');
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > MAX_PAGE_SIZE) {
      throw new Error(`limit must be between 1 and ${MAX_PAGE_SIZE}.`);
    }
    if (input.cursor !== undefined) validateCursor(input.cursor);
    const page = await this.history.listByCustomer(input);
    if (page.entries.length > input.limit)
      throw new Error('Ledger reader exceeded requested limit.');
    let prior = input.cursor;
    for (const entry of page.entries) {
      try {
        assertLedgerEntry(entry);
      } catch {
        throw new LoyaltyLedgerCorruptionError('invalid-record');
      }
      if (entry.customerKey !== input.customerKey)
        throw new Error('Ledger reader crossed customer boundary.');
      const current = { sequence: entry.sequence, entryId: entry.id };
      if (prior !== undefined && compareCursor(prior, current) >= 0) {
        throw new Error('Ledger page is not strictly ordered.');
      }
      prior = current;
    }
    if (page.nextCursor !== null) {
      validateCursor(page.nextCursor);
      if (
        prior === undefined ||
        page.nextCursor.sequence !== prior.sequence ||
        page.nextCursor.entryId !== prior.entryId
      ) {
        throw new Error('Ledger cursor does not match the last entry.');
      }
    }
    return page;
  }
}

export class MemoryLoyaltyLedgerHistoryReader implements LoyaltyLedgerHistoryReader {
  private readonly documents: DocumentStore<LoyaltyLedgerEntryDocument>;

  constructor(documents: DocumentStore<LoyaltyLedgerEntryDocument>) {
    this.documents = documents;
  }

  async listByCustomer(input: {
    readonly customerKey: string;
    readonly limit: number;
    readonly cursor?: LoyaltyLedgerCursor;
  }): Promise<LoyaltyLedgerPage> {
    const all: LoyaltyLedgerEntryDocument[] = [];
    for (const entry of await this.documents.list()) {
      try {
        assertLedgerEntry(entry);
      } catch {
        throw new LoyaltyLedgerCorruptionError('invalid-record');
      }
      if (entry.customerKey === input.customerKey) all.push(entry);
    }
    all.sort((a, b) => a.sequence - b.sequence || a.id.localeCompare(b.id));
    const remaining = all.filter(
      (entry) =>
        input.cursor === undefined ||
        entry.sequence > input.cursor.sequence ||
        (entry.sequence === input.cursor.sequence && entry.id > input.cursor.entryId)
    );
    const entries = remaining.slice(0, input.limit);
    const last = entries.at(-1);
    return {
      entries,
      nextCursor:
        remaining.length > entries.length && last
          ? { sequence: last.sequence, entryId: last.id }
          : null,
    };
  }
}

export function loyaltyLedgerEntryId(checkoutId: string): string {
  assertIdentifier(checkoutId, 'checkoutId');
  return `${LEDGER_PREFIX}${Buffer.from(checkoutId, 'utf8').toString('base64url')}`;
}

export function ledgerEntryMatchesAward(
  entry: LoyaltyLedgerEntryDocument,
  identity: DurableCustomerIdentity,
  expected: Omit<PendingLoyaltyAward, 'sequence' | 'awardedAt'>
): boolean {
  return (
    entry.customerKey === identity.customerKey &&
    entry.customerKeyVersion === identity.keyVersion &&
    entry.checkoutId === expected.checkoutId &&
    entry.transactionId === expected.transactionId &&
    entry.storeId === expected.storeId &&
    entry.currency === expected.currency &&
    entry.totalMinorUnits === expected.totalMinorUnits &&
    entry.points === expected.points &&
    entry.policyVersion === expected.policyVersion
  );
}

function assertLedgerEntry(value: unknown): asserts value is LoyaltyLedgerEntryDocument {
  if (!isRecord(value)) throw new Error('Ledger entry must be an object.');
  const expected = [
    'id',
    'kind',
    'schemaVersion',
    'customerKey',
    'customerKeyVersion',
    'checkoutId',
    'transactionId',
    'storeId',
    'currency',
    'totalMinorUnits',
    'points',
    'policyVersion',
    'sequence',
    'awardedAt',
  ];
  const keys = Object.keys(value);
  if (keys.length !== expected.length || keys.some((key) => !expected.includes(key))) {
    throw new Error('Ledger entry has an invalid shape.');
  }
  if (value['kind'] !== 'loyalty-ledger-entry' || value['schemaVersion'] !== 1) {
    throw new Error('Ledger entry has an invalid kind or schema.');
  }
  assertIdentifier(value['customerKey'], 'customerKey');
  if (value['customerKeyVersion'] !== 'sha256-v1') throw new Error('Invalid customer key version.');
  const award = {
    checkoutId: value['checkoutId'],
    transactionId: value['transactionId'],
    storeId: value['storeId'],
    currency: value['currency'],
    totalMinorUnits: value['totalMinorUnits'],
    points: value['points'],
    policyVersion: value['policyVersion'],
    sequence: value['sequence'],
    awardedAt: value['awardedAt'],
  };
  assertPendingAward(award);
  if (value['id'] !== loyaltyLedgerEntryId(award.checkoutId)) {
    throw new Error('Ledger entry id is inconsistent.');
  }
}

function sameLedgerEntry(
  left: LoyaltyLedgerEntryDocument,
  right: LoyaltyLedgerEntryDocument
): boolean {
  return (
    left.id === right.id &&
    left.customerKey === right.customerKey &&
    left.customerKeyVersion === right.customerKeyVersion &&
    samePendingAward(left, right)
  );
}

function validateCursor(cursor: LoyaltyLedgerCursor): void {
  if (!Number.isSafeInteger(cursor.sequence) || cursor.sequence < 1)
    throw new Error('Invalid ledger cursor sequence.');
  assertIdentifier(cursor.entryId, 'cursor.entryId');
}

function compareCursor(left: LoyaltyLedgerCursor, right: LoyaltyLedgerCursor): number {
  return left.sequence - right.sequence || left.entryId.localeCompare(right.entryId);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
