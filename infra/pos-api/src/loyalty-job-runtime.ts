import { createHash } from 'node:crypto';
import type { CheckoutStoredDocument } from './checkout-store.ts';
import { DocumentCheckoutStore } from './checkout-store.ts';
import { CheckoutLoyaltyStore } from './checkout-loyalty-store.ts';
import { CloudantDueCheckoutReader } from './cloudant-checkout-store.ts';
import {
  CloudantDueLoyaltyReader,
  CloudantLoyaltyLedgerHistoryReader,
} from './cloudant-loyalty-store.ts';
import { CloudantStore } from './cloudant-store.ts';
import { CustomerLoyaltyService } from './customer-loyalty-service.ts';
import { CustomerProfileStore, type CustomerProfileDocument } from './customer-profile-store.ts';
import { LoyaltyLedgerStore, type LoyaltyLedgerEntryDocument } from './loyalty-ledger-store.ts';
import {
  buildLoyaltyReconciliationRuntime,
  type LoyaltyReconciliationRuntime,
} from './loyalty-reconciliation-runtime.ts';

export function buildLoyaltyJobRuntime(
  environment: Readonly<Record<string, string | undefined>>,
  nowIso: () => string
): LoyaltyReconciliationRuntime {
  const cloudant = Object.freeze({
    url: required(environment, 'CLOUDANT_URL').replace(/\/+$/, ''),
    apiKey: required(environment, 'CLOUDANT_APIKEY'),
  });
  const checkoutDocuments = new CloudantStore<CheckoutStoredDocument>({
    ...cloudant,
    database: databaseName(environment['CLOUDANT_CHECKOUTS_DB'] ?? 'checkouts'),
  });
  const ledgerDocuments = new CloudantStore<LoyaltyLedgerEntryDocument>({
    ...cloudant,
    database: databaseName(environment['CLOUDANT_LOYALTY_LEDGER_DB'] ?? 'loyalty-ledger'),
  });
  const profiles = new CustomerProfileStore(
    new CloudantStore<CustomerProfileDocument>({
      ...cloudant,
      database: databaseName(environment['CLOUDANT_CUSTOMER_PROFILES_DB'] ?? 'customer-profiles'),
    })
  );
  const checkouts = new DocumentCheckoutStore(
    checkoutDocuments,
    (value) => createHash('sha256').update(value).digest('base64url'),
    new CloudantDueCheckoutReader(checkoutDocuments)
  );
  const loyaltyCheckouts = new CheckoutLoyaltyStore(
    checkouts,
    new CloudantDueLoyaltyReader(checkoutDocuments)
  );
  const ledger = new LoyaltyLedgerStore(
    ledgerDocuments,
    new CloudantLoyaltyLedgerHistoryReader(ledgerDocuments)
  );
  return buildLoyaltyReconciliationRuntime({
    checkouts: loyaltyCheckouts,
    loyalty: new CustomerLoyaltyService(profiles, ledger, nowIso),
    nowIso,
  });
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
