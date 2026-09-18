import { createHash, randomUUID } from 'node:crypto';
import type { ProductDocument, TransactionDocument } from './api.ts';
import { loadCheckoutConfig } from './checkout-config.ts';
import { CloudantDueCheckoutReader } from './cloudant-checkout-store.ts';
import { createPayPalSdkGateway } from './checkout-paypal.ts';
import { loadCheckoutSecrets } from './checkout-secrets.ts';
import { CheckoutService } from './checkout-service.ts';
import { DocumentCheckoutStore, type CheckoutStoredDocument } from './checkout-store.ts';
import { CloudantStore } from './cloudant-store.ts';

interface CheckoutCloudantRuntime {
  readonly cloudant: { readonly url: string; readonly apiKey: string };
  readonly checkoutStore: CloudantStore<CheckoutStoredDocument>;
  readonly checkoutDatabase: string;
}

export function buildCheckoutMigrationRuntime(
  environment: Readonly<Record<string, string | undefined>>
): Pick<CheckoutCloudantRuntime, 'checkoutStore' | 'checkoutDatabase'> {
  const runtime = buildCheckoutCloudantRuntime(environment);
  return Object.freeze({
    checkoutStore: runtime.checkoutStore,
    checkoutDatabase: runtime.checkoutDatabase,
  });
}

export function buildCheckoutJobRuntime(
  environment: Readonly<Record<string, string | undefined>>
): {
  readonly dueCheckouts: CloudantDueCheckoutReader;
  readonly service: CheckoutService;
} {
  const runtime = buildCheckoutCloudantRuntime(environment);
  const dueCheckouts = new CloudantDueCheckoutReader(runtime.checkoutStore);
  const checkouts = new DocumentCheckoutStore(
    runtime.checkoutStore,
    (value) => createHash('sha256').update(value).digest('base64url'),
    dueCheckouts
  );
  const config = loadCheckoutConfig(environment, 'production');
  return Object.freeze({
    dueCheckouts,
    service: new CheckoutService({
      checkouts,
      products: new CloudantStore<ProductDocument>({
        ...runtime.cloudant,
        database: environment['CLOUDANT_PRODUCTS_DB'] ?? 'products',
      }),
      transactions: new CloudantStore<TransactionDocument>({
        ...runtime.cloudant,
        database: environment['CLOUDANT_TRANSACTIONS_DB'] ?? 'transactions',
      }),
      paypal: createPayPalSdkGateway({
        clientId: config.paypalClientId,
        clientSecret: config.paypalClientSecret,
        environment: config.paypalEnvironment,
        timeoutMs: config.paypalTimeoutMs,
      }),
      config,
      secrets: loadCheckoutSecrets(environment),
      nowIso: () => new Date().toISOString(),
      newId: randomUUID,
    }),
  });
}

export function positiveIntegerEnvironment(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
  fallback: number,
  maximum: number
): number {
  const raw = environment[name];
  if (raw === undefined) return fallback;
  if (!/^[1-9]\d*$/.test(raw)) throw new Error(`${name} must be a positive base-10 integer.`);
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value > maximum) {
    throw new Error(`${name} is outside its allowed range.`);
  }
  return value;
}

function buildCheckoutCloudantRuntime(
  environment: Readonly<Record<string, string | undefined>>
): CheckoutCloudantRuntime {
  const cloudant = Object.freeze({
    url: required(environment, 'CLOUDANT_URL').replace(/\/+$/, ''),
    apiKey: required(environment, 'CLOUDANT_APIKEY'),
  });
  const checkoutDatabase = databaseName(environment['CLOUDANT_CHECKOUTS_DB'] ?? 'checkouts');
  return Object.freeze({
    cloudant,
    checkoutDatabase,
    checkoutStore: new CloudantStore<CheckoutStoredDocument>({
      ...cloudant,
      database: checkoutDatabase,
    }),
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
    throw new Error('CLOUDANT_CHECKOUTS_DB is invalid.');
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
