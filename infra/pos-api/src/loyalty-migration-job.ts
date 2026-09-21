import type { StoredDocument } from '../../shared/src/document-store.ts';
import { CloudantStore } from './cloudant-store.ts';
import type { CheckoutStoredDocument } from './checkout-store.ts';
import type { LoyaltyLedgerEntryDocument } from './loyalty-ledger-store.ts';
import { migrateLoyaltyDatabases } from './loyalty-migration.ts';

interface LoyaltyMigrationRuntime {
  readonly checkoutStore: CloudantStore<CheckoutStoredDocument>;
  readonly checkoutDatabase: string;
  readonly ledgerStore: CloudantStore<LoyaltyLedgerEntryDocument>;
  readonly ledgerDatabase: string;
}

export async function runLoyaltyMigrationJob(
  environment: Readonly<Record<string, string | undefined>> = process.env,
  log: (message: string, details: unknown) => void = console.log
): Promise<void> {
  const runtime = buildLoyaltyMigrationRuntime(environment);
  const results = await migrateLoyaltyDatabases(runtime);
  log('[pos-api] loyalty migration complete', { indexes: results });
}

function buildLoyaltyMigrationRuntime(
  environment: Readonly<Record<string, string | undefined>>
): LoyaltyMigrationRuntime {
  const cloudant = Object.freeze({
    url: required(environment, 'CLOUDANT_URL').replace(/\/+$/, ''),
    apiKey: required(environment, 'CLOUDANT_APIKEY'),
  });
  const checkoutDatabase = databaseName(environment['CLOUDANT_CHECKOUTS_DB'] ?? 'checkouts');
  const ledgerDatabase = databaseName(
    environment['CLOUDANT_LOYALTY_LEDGER_DB'] ?? 'loyalty-ledger'
  );
  return Object.freeze({
    checkoutDatabase,
    checkoutStore: cloudantStore<CheckoutStoredDocument>(cloudant, checkoutDatabase),
    ledgerDatabase,
    ledgerStore: cloudantStore<LoyaltyLedgerEntryDocument>(cloudant, ledgerDatabase),
  });
}

function cloudantStore<T extends StoredDocument>(
  cloudant: Readonly<{ readonly url: string; readonly apiKey: string }>,
  database: string
): CloudantStore<T> {
  return new CloudantStore<T>({ ...cloudant, database });
}

function databaseName(value: string): string {
  if (
    value.length < 1 ||
    value.length > 238 ||
    !/^[a-z][a-z0-9_$()+/-]*$/.test(value) ||
    value === '_users' ||
    value === '_replicator'
  ) {
    throw new Error('Cloudant loyalty database name is invalid.');
  }
  return value;
}

function required(environment: Readonly<Record<string, string | undefined>>, name: string): string {
  const value = environment[name];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`${name} is required.`);
  }
  return value.trim();
}

if (process.env['NODE_ENV'] !== 'test') {
  await runLoyaltyMigrationJob();
}
