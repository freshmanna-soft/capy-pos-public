import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckoutJobRuntime,
  buildCheckoutMigrationRuntime,
  positiveIntegerEnvironment,
} from './checkout-job-runtime.ts';

const CLOUDANT_ONLY_ENV = {
  CLOUDANT_URL: 'https://cloudant.example/',
  CLOUDANT_APIKEY: 'cloudant-key',
  CLOUDANT_CHECKOUTS_DB: 'checkout_test',
};

const FULL_ENV = {
  ...CLOUDANT_ONLY_ENV,
  CLOUDANT_PRODUCTS_DB: 'product_test',
  CLOUDANT_TRANSACTIONS_DB: 'transaction_test',
  CHECKOUT_STORE_ID: 'store-1',
  PAYPAL_EXPECTED_MERCHANT_ID: 'merchant-1',
  CHECKOUT_IDEMPOTENCY_KEY_VERSION: 'v1',
  CHECKOUT_CAPABILITY_KEY_VERSION: 'v1',
  PAYPAL_CLIENT_ID: 'paypal-client',
  PAYPAL_CLIENT_SECRET: 'paypal-secret',
  PAYPAL_ENVIRONMENT: 'production',
  PAYPAL_TIMEOUT_MS: '10000',
  CHECKOUT_CURRENCY: 'USD',
  CHECKOUT_TAX_BASIS_POINTS: '850',
  CHECKOUT_MAX_ITEM_QUANTITY: '100',
  CHECKOUT_MAX_AGGREGATE_QUANTITY: '500',
  CHECKOUT_MAX_TOTAL_MINOR_UNITS: '100000',
  CHECKOUT_IDEMPOTENCY_HMAC_KEYS_JSON: JSON.stringify({ v1: 'i'.repeat(32) }),
  CHECKOUT_CAPABILITY_HMAC_KEYS_JSON: JSON.stringify({ v1: 'c'.repeat(32) }),
};

describe('checkout job runtime', () => {
  it('builds the migration runtime without PayPal or HMAC configuration', () => {
    const runtime = buildCheckoutMigrationRuntime(CLOUDANT_ONLY_ENV);

    assert.equal(runtime.checkoutDatabase, 'checkout_test');
    assert.ok(runtime.checkoutStore);
    assert.deepEqual(Object.keys(runtime).sort(), ['checkoutDatabase', 'checkoutStore']);
  });

  it('requires only Cloudant configuration for migration', () => {
    assert.throws(() => buildCheckoutMigrationRuntime({}), /CLOUDANT_URL/);
    assert.throws(
      () => buildCheckoutMigrationRuntime({ CLOUDANT_URL: 'https://cloudant.example' }),
      /CLOUDANT_APIKEY/
    );
    assert.throws(
      () => buildCheckoutMigrationRuntime({ ...CLOUDANT_ONLY_ENV, CLOUDANT_CHECKOUTS_DB: '../x' }),
      /CLOUDANT_CHECKOUTS_DB/
    );
  });

  it('builds the reconciliation service only with complete checkout configuration', () => {
    const runtime = buildCheckoutJobRuntime(FULL_ENV);

    assert.ok(runtime.dueCheckouts);
    assert.ok(runtime.service);
    assert.deepEqual(Object.keys(runtime).sort(), ['dueCheckouts', 'service']);
    assert.throws(() => buildCheckoutJobRuntime(CLOUDANT_ONLY_ENV), /CHECKOUT_CURRENCY/);
  });

  it('parses bounded positive worker settings', () => {
    assert.equal(positiveIntegerEnvironment({}, 'LIMIT', 7, 10), 7);
    assert.equal(positiveIntegerEnvironment({ LIMIT: '10' }, 'LIMIT', 7, 10), 10);
    for (const raw of ['0', '-1', '1.5', '01', '11', '9007199254740992']) {
      assert.throws(() => positiveIntegerEnvironment({ LIMIT: raw }, 'LIMIT', 7, 10), /LIMIT/);
    }
  });
});
