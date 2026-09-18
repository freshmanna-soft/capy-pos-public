import type { CloudantStore } from './cloudant-store.ts';
import type {
  CheckoutDocument,
  CheckoutStoredDocument,
  DueCheckoutCursor,
  DueCheckoutPage,
  DueCheckoutReader,
} from './checkout-store.ts';

export const CHECKOUT_DUE_INDEX_DDOC = 'checkout-due';
export const CHECKOUT_DUE_INDEX_NAME = 'by-kind-next-action-id';

interface CloudantFindResponse {
  readonly docs?: readonly Record<string, unknown>[];
}

/** Production due reader: one bounded Mango query, never `_all_docs`. */
export class CloudantDueCheckoutReader implements DueCheckoutReader {
  private readonly store: CloudantStore<CheckoutStoredDocument>;

  constructor(store: CloudantStore<CheckoutStoredDocument>) {
    this.store = store;
  }

  async listDue(input: {
    readonly asOf: string;
    readonly limit: number;
    readonly cursor?: DueCheckoutCursor;
  }): Promise<DueCheckoutPage> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100) {
      throw new Error('Cloudant checkout due query limit is invalid.');
    }
    const selector = input.cursor
      ? {
          kind: { $eq: 'checkout' },
          nextActionAt: { $ne: null, $lte: input.asOf },
          $or: [
            { nextActionAt: { $gt: input.cursor.nextActionAt } },
            {
              nextActionAt: { $eq: input.cursor.nextActionAt },
              id: { $gt: input.cursor.checkoutId },
            },
          ],
        }
      : {
          kind: { $eq: 'checkout' },
          nextActionAt: { $ne: null, $lte: input.asOf },
        };
    const response = await this.store.databaseRequest('POST', '/_find', {
      selector,
      sort: [{ nextActionAt: 'asc' }, { id: 'asc' }],
      limit: input.limit + 1,
      use_index: [CHECKOUT_DUE_INDEX_DDOC, CHECKOUT_DUE_INDEX_NAME],
      execution_stats: false,
    });
    if (!response.ok) {
      throw new Error(
        `Cloudant checkout due query failed with ${response.status}. ` +
          `Verify index ${CHECKOUT_DUE_INDEX_DDOC}/${CHECKOUT_DUE_INDEX_NAME} is provisioned.`
      );
    }
    const body = (await response.json()) as CloudantFindResponse;
    if (!Array.isArray(body.docs)) {
      throw new Error('Cloudant checkout due query returned no docs array.');
    }
    const decoded = body.docs.map(stripCloudantMeta);
    const checkouts = decoded.slice(0, input.limit);
    const last = checkouts.at(-1);
    return {
      checkouts,
      nextCursor:
        decoded.length > input.limit && last !== undefined && last.nextActionAt !== null
          ? {
              asOf: input.asOf,
              nextActionAt: last.nextActionAt,
              checkoutId: last.id,
            }
          : null,
    };
  }
}

function stripCloudantMeta(raw: Record<string, unknown>): CheckoutDocument {
  const { _id, _rev, ...document } = raw;
  return {
    ...document,
    id: typeof _id === 'string' ? _id : String(document['id'] ?? ''),
  } as unknown as CheckoutDocument;
}
