import type { CloudantStore } from './cloudant-store.ts';
import type { CheckoutStoredDocument } from './checkout-store.ts';
import { CHECKOUT_DUE_INDEX_DDOC, CHECKOUT_DUE_INDEX_NAME } from './cloudant-checkout-store.ts';

export interface CheckoutMigrationResult {
  readonly database: string;
  readonly designDocument: string;
  readonly index: string;
  readonly outcome: 'created' | 'exists';
}

interface CheckoutIndexResponse {
  readonly result?: unknown;
  readonly id?: unknown;
  readonly name?: unknown;
}

const CHECKOUT_DUE_INDEX_FIELDS = ['kind', 'nextActionAt', 'id'] as const;

/** Creates the required due-checkout Mango index and proves Cloudant can select it. */
export async function migrateCheckoutDatabase(
  store: CloudantStore<CheckoutStoredDocument>,
  database: string
): Promise<CheckoutMigrationResult> {
  assertDatabaseName(database);

  const createResponse = await store.databaseRequest('POST', '/_index', {
    index: { fields: CHECKOUT_DUE_INDEX_FIELDS },
    ddoc: CHECKOUT_DUE_INDEX_DDOC,
    name: CHECKOUT_DUE_INDEX_NAME,
    type: 'json',
    partitioned: false,
  });
  if (!createResponse.ok) {
    throw new Error(`Cloudant checkout index creation failed with ${createResponse.status}.`);
  }

  const createBody = (await createResponse.json()) as CheckoutIndexResponse;
  const outcome = parseIndexOutcome(createBody);

  const verifyResponse = await store.databaseRequest('POST', '/_find', {
    selector: {
      kind: { $eq: 'checkout' },
      nextActionAt: { $gt: null },
      id: { $gt: null },
    },
    sort: [{ nextActionAt: 'asc' }, { id: 'asc' }],
    limit: 1,
    use_index: [CHECKOUT_DUE_INDEX_DDOC, CHECKOUT_DUE_INDEX_NAME],
    execution_stats: false,
  });
  if (!verifyResponse.ok) {
    throw new Error(`Cloudant checkout index verification failed with ${verifyResponse.status}.`);
  }
  const verifyBody = (await verifyResponse.json()) as { docs?: unknown };
  if (!Array.isArray(verifyBody.docs)) {
    throw new Error('Cloudant checkout index verification returned no docs array.');
  }

  return {
    database,
    designDocument: CHECKOUT_DUE_INDEX_DDOC,
    index: CHECKOUT_DUE_INDEX_NAME,
    outcome,
  };
}

function parseIndexOutcome(body: CheckoutIndexResponse): CheckoutMigrationResult['outcome'] {
  if (
    (body.result !== 'created' && body.result !== 'exists') ||
    body.id !== `_design/${CHECKOUT_DUE_INDEX_DDOC}` ||
    body.name !== CHECKOUT_DUE_INDEX_NAME
  ) {
    throw new Error('Cloudant checkout index creation returned an invalid response.');
  }
  return body.result;
}

function assertDatabaseName(value: string): void {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 238 ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    throw new Error('Cloudant checkout database name is invalid.');
  }
}
