import type { CloudantStore } from './cloudant-store.ts';
import type { CheckoutDocument, CheckoutStoredDocument } from './checkout-store.ts';
import type {
  LoyaltyLedgerEntryDocument,
  LoyaltyLedgerHistoryReader,
  LoyaltyLedgerPage,
} from './loyalty-ledger-store.ts';
import type {
  DueLoyaltyCursor,
  DueLoyaltyPage,
  DueLoyaltyReader,
} from './loyalty-reconciliation.ts';
import {
  CHECKOUT_LOYALTY_DUE_INDEX_DDOC,
  CHECKOUT_LOYALTY_DUE_INDEX_NAME,
  LOYALTY_LEDGER_INDEX_DDOC,
  LOYALTY_LEDGER_INDEX_NAME,
} from './loyalty-migration.ts';

interface CloudantFindResponse {
  readonly docs?: readonly Record<string, unknown>[];
}

export class CloudantDueLoyaltyReader implements DueLoyaltyReader {
  private readonly store: CloudantStore<CheckoutStoredDocument>;

  constructor(store: CloudantStore<CheckoutStoredDocument>) {
    this.store = store;
  }

  async listDueLoyalty(input: {
    readonly asOf: string;
    readonly limit: number;
    readonly cursor?: DueLoyaltyCursor;
  }): Promise<DueLoyaltyPage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('Cloudant loyalty due query limit is invalid.');
    }
    const selector = input.cursor
      ? {
          kind: { $eq: 'checkout' },
          state: { $eq: 'completed' },
          'loyalty.status': { $eq: 'pending' },
          'loyalty.nextActionAt': { $ne: null, $lte: input.asOf },
          $or: [
            { 'loyalty.nextActionAt': { $gt: input.cursor.nextActionAt } },
            {
              'loyalty.nextActionAt': { $eq: input.cursor.nextActionAt },
              id: { $gt: input.cursor.checkoutId },
            },
          ],
        }
      : {
          kind: { $eq: 'checkout' },
          state: { $eq: 'completed' },
          'loyalty.status': { $eq: 'pending' },
          'loyalty.nextActionAt': { $ne: null, $lte: input.asOf },
        };
    const response = await this.store.databaseRequest('POST', '/_find', {
      selector,
      sort: [{ 'loyalty.nextActionAt': 'asc' }, { id: 'asc' }],
      limit: input.limit + 1,
      use_index: [CHECKOUT_LOYALTY_DUE_INDEX_DDOC, CHECKOUT_LOYALTY_DUE_INDEX_NAME],
      execution_stats: false,
    });
    const docs = await decodeFind(
      response,
      `Cloudant checkout loyalty query failed; verify index ${CHECKOUT_LOYALTY_DUE_INDEX_DDOC}/${CHECKOUT_LOYALTY_DUE_INDEX_NAME}`
    );
    const decoded = docs.map(stripCheckoutMeta);
    const selected = decoded.slice(0, input.limit);
    const last = selected.at(-1);
    return {
      checkouts: selected.map(({ id }) => ({ id })),
      nextCursor:
        decoded.length > input.limit && last?.loyalty?.status === 'pending'
          ? {
              asOf: input.asOf,
              nextActionAt: last.loyalty.nextActionAt!,
              checkoutId: last.id,
            }
          : null,
    };
  }
}

export class CloudantLoyaltyLedgerHistoryReader implements LoyaltyLedgerHistoryReader {
  private readonly store: CloudantStore<LoyaltyLedgerEntryDocument>;

  constructor(store: CloudantStore<LoyaltyLedgerEntryDocument>) {
    this.store = store;
  }

  async listByCustomer(input: {
    readonly customerKey: string;
    readonly limit: number;
    readonly cursor?: { readonly sequence: number; readonly entryId: string };
  }): Promise<LoyaltyLedgerPage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('Cloudant loyalty ledger query limit is invalid.');
    }
    const selector = input.cursor
      ? {
          kind: { $eq: 'loyalty-ledger-entry' },
          customerKey: { $eq: input.customerKey },
          $or: [
            { sequence: { $gt: input.cursor.sequence } },
            {
              sequence: { $eq: input.cursor.sequence },
              id: { $gt: input.cursor.entryId },
            },
          ],
        }
      : {
          kind: { $eq: 'loyalty-ledger-entry' },
          customerKey: { $eq: input.customerKey },
        };
    const response = await this.store.databaseRequest('POST', '/_find', {
      selector,
      sort: [{ sequence: 'asc' }, { id: 'asc' }],
      limit: input.limit + 1,
      use_index: [LOYALTY_LEDGER_INDEX_DDOC, LOYALTY_LEDGER_INDEX_NAME],
      execution_stats: false,
    });
    const docs = await decodeFind(
      response,
      `Cloudant loyalty ledger query failed; verify index ${LOYALTY_LEDGER_INDEX_DDOC}/${LOYALTY_LEDGER_INDEX_NAME}`
    );
    const decoded = docs.map(stripLedgerMeta);
    const entries = decoded.slice(0, input.limit);
    const last = entries.at(-1);
    return {
      entries,
      nextCursor:
        decoded.length > input.limit && last !== undefined
          ? { sequence: last.sequence, entryId: last.id }
          : null,
    };
  }
}

async function decodeFind(
  response: Response,
  failure: string
): Promise<readonly Record<string, unknown>[]> {
  if (!response.ok) throw new Error(`${failure} (${response.status}).`);
  const body = (await response.json()) as CloudantFindResponse;
  if (!Array.isArray(body.docs)) throw new Error('Cloudant loyalty query returned no docs array.');
  return body.docs;
}

function stripCheckoutMeta(raw: Record<string, unknown>): CheckoutDocument {
  const { _id, _rev, ...document } = raw;
  return {
    ...document,
    id: typeof _id === 'string' ? _id : String(document['id'] ?? ''),
  } as unknown as CheckoutDocument;
}

function stripLedgerMeta(raw: Record<string, unknown>): LoyaltyLedgerEntryDocument {
  const { _id, _rev, ...document } = raw;
  return {
    ...document,
    id: typeof _id === 'string' ? _id : String(document['id'] ?? ''),
  } as unknown as LoyaltyLedgerEntryDocument;
}
