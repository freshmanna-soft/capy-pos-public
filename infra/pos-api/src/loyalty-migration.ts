import type { CloudantStore } from './cloudant-store.ts';
import type { CheckoutStoredDocument } from './checkout-store.ts';
import type { LoyaltyLedgerEntryDocument } from './loyalty-ledger-store.ts';

export const LOYALTY_LEDGER_INDEX_DDOC = 'loyalty-ledger-customer-sequence';
export const LOYALTY_LEDGER_INDEX_NAME = 'by-customer-sequence-id';
export const CHECKOUT_LOYALTY_DUE_INDEX_DDOC = 'checkout-loyalty-due';
export const CHECKOUT_LOYALTY_DUE_INDEX_NAME = 'by-kind-state-loyalty-status-next-action-id';

export interface LoyaltyMigrationResult {
  readonly database: string;
  readonly designDocument: string;
  readonly index: string;
  readonly outcome: 'created' | 'exists';
}

interface IndexResponse {
  readonly result?: unknown;
  readonly id?: unknown;
  readonly name?: unknown;
}

interface IndexDefinition {
  readonly fields: readonly string[];
  readonly designDocument: string;
  readonly name: string;
  readonly selector: Readonly<Record<string, unknown>>;
  readonly sort: readonly object[];
}

const LEDGER_INDEX: IndexDefinition = Object.freeze({
  fields: Object.freeze(['kind', 'customerKey', 'sequence', 'id']),
  designDocument: LOYALTY_LEDGER_INDEX_DDOC,
  name: LOYALTY_LEDGER_INDEX_NAME,
  selector: Object.freeze({
    kind: Object.freeze({ $eq: 'loyalty-ledger-entry' }),
    customerKey: Object.freeze({ $eq: 'migration-verification-key' }),
    sequence: Object.freeze({ $gte: 0 }),
    id: Object.freeze({ $gt: null }),
  }),
  sort: Object.freeze([{ sequence: 'asc' as const }, { id: 'asc' as const }]),
});

const CHECKOUT_LOYALTY_DUE_INDEX: IndexDefinition = Object.freeze({
  fields: Object.freeze(['kind', 'state', 'loyalty.status', 'loyalty.nextActionAt', 'id']),
  designDocument: CHECKOUT_LOYALTY_DUE_INDEX_DDOC,
  name: CHECKOUT_LOYALTY_DUE_INDEX_NAME,
  selector: Object.freeze({
    kind: Object.freeze({ $eq: 'checkout' }),
    state: Object.freeze({ $eq: 'completed' }),
    'loyalty.status': Object.freeze({ $eq: 'pending' }),
    'loyalty.nextActionAt': Object.freeze({ $gt: null }),
    id: Object.freeze({ $gt: null }),
  }),
  sort: Object.freeze([{ 'loyalty.nextActionAt': 'asc' as const }, { id: 'asc' as const }]),
});

/** Creates and proves the ledger history and completed-checkout loyalty-due indexes. */
export async function migrateLoyaltyDatabases(input: {
  readonly ledgerStore: CloudantStore<LoyaltyLedgerEntryDocument>;
  readonly ledgerDatabase: string;
  readonly checkoutStore: CloudantStore<CheckoutStoredDocument>;
  readonly checkoutDatabase: string;
}): Promise<readonly LoyaltyMigrationResult[]> {
  return Object.freeze([
    await migrateIndex(input.ledgerStore, input.ledgerDatabase, LEDGER_INDEX),
    await migrateIndex(input.checkoutStore, input.checkoutDatabase, CHECKOUT_LOYALTY_DUE_INDEX),
  ]);
}

async function migrateIndex<T extends { readonly id: string }>(
  store: CloudantStore<T>,
  database: string,
  definition: IndexDefinition
): Promise<LoyaltyMigrationResult> {
  assertDatabaseName(database);
  const createResponse = await store.databaseRequest('POST', '/_index', {
    index: { fields: definition.fields },
    ddoc: definition.designDocument,
    name: definition.name,
    type: 'json',
    partitioned: false,
  });
  if (!createResponse.ok) {
    throw new Error(`Cloudant loyalty index creation failed with ${createResponse.status}.`);
  }
  const outcome = parseIndexOutcome(
    (await createResponse.json()) as IndexResponse,
    definition.designDocument,
    definition.name
  );

  const verifyResponse = await store.databaseRequest('POST', '/_find', {
    selector: definition.selector,
    sort: definition.sort,
    limit: 1,
    use_index: [definition.designDocument, definition.name],
    execution_stats: false,
  });
  if (!verifyResponse.ok) {
    throw new Error(`Cloudant loyalty index verification failed with ${verifyResponse.status}.`);
  }
  const verifyBody = (await verifyResponse.json()) as { docs?: unknown };
  if (!Array.isArray(verifyBody.docs)) {
    throw new Error('Cloudant loyalty index verification returned no docs array.');
  }

  return Object.freeze({
    database,
    designDocument: definition.designDocument,
    index: definition.name,
    outcome,
  });
}

function parseIndexOutcome(
  body: IndexResponse,
  designDocument: string,
  name: string
): LoyaltyMigrationResult['outcome'] {
  if (
    (body.result !== 'created' && body.result !== 'exists') ||
    body.id !== `_design/${designDocument}` ||
    body.name !== name
  ) {
    throw new Error('Cloudant loyalty index creation returned an invalid response.');
  }
  return body.result;
}

function assertDatabaseName(value: string): void {
  if (
    value.length < 1 ||
    value.length > 238 ||
    !/^[a-z][a-z0-9_$()+/-]*$/.test(value) ||
    value === '_users' ||
    value === '_replicator'
  ) {
    throw new Error('Cloudant loyalty database name is invalid.');
  }
}
