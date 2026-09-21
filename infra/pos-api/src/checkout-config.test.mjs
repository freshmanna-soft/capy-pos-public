import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { loadCheckoutConfig } from './checkout-config.ts';

const REQUIRED = {
  CHECKOUT_STORE_ID: 'store-1',
  PAYPAL_EXPECTED_MERCHANT_ID: 'merchant-1',
  CHECKOUT_IDEMPOTENCY_KEY_VERSION: 'v1',
  CHECKOUT_CAPABILITY_KEY_VERSION: 'v1',
  PAYPAL_CLIENT_ID: 'test-client-id',
  PAYPAL_CLIENT_SECRET: 'test-client-secret',
};

const PRODUCTION_POLICY = {
  CHECKOUT_CURRENCY: 'USD',
  CHECKOUT_TAX_BASIS_POINTS: '2100',
  CHECKOUT_MAX_ITEM_QUANTITY: '10000',
  CHECKOUT_MAX_AGGREGATE_QUANTITY: '50000',
  CHECKOUT_MAX_TOTAL_MINOR_UNITS: '100000000',
  PAYPAL_ENVIRONMENT: 'production',
  PAYPAL_TIMEOUT_MS: '10000',
};

describe('checkout config', () => {
  it('requires explicit supported production currency and tax policy', () => {
    assert.throws(() => loadCheckoutConfig(REQUIRED, 'production'));
    const config = loadCheckoutConfig({ ...REQUIRED, ...PRODUCTION_POLICY }, 'production');
    assert.equal(config.currency, 'USD');
    assert.equal(config.taxRateBasisPoints, 2100);
    assert.throws(() =>
      loadCheckoutConfig(
        { ...REQUIRED, ...PRODUCTION_POLICY, CHECKOUT_CURRENCY: 'EUR' },
        'production'
      )
    );
  });

  it('allows documented local defaults only in explicit development mode', () => {
    const config = loadCheckoutConfig(REQUIRED, 'development');
    assert.equal(config.currency, 'USD');
    assert.equal(config.taxRateBasisPoints, 850);
    assert.equal(config.paypalEnvironment, 'sandbox');
    assert.equal(config.paypalTimeoutMs, 10_000);
  });

  it('defaults Batch 4 writes off and accepts only explicit boolean flags', () => {
    const defaults = loadCheckoutConfig(REQUIRED, 'development');
    assert.equal(defaults.checkoutV2WritesEnabled, false);
    assert.equal(defaults.customerLoyaltyEnabled, false);

    const enabled = loadCheckoutConfig(
      {
        ...REQUIRED,
        CHECKOUT_V2_WRITES_ENABLED: 'true',
        CUSTOMER_LOYALTY_ENABLED: 'true',
      },
      'development'
    );
    assert.equal(enabled.checkoutV2WritesEnabled, true);
    assert.equal(enabled.customerLoyaltyEnabled, true);
    assert.throws(() =>
      loadCheckoutConfig({ ...REQUIRED, CHECKOUT_V2_WRITES_ENABLED: '1' }, 'development')
    );
  });

  it('requires credentials, a finite timeout, and production PayPal in production mode', () => {
    assert.throws(() =>
      loadCheckoutConfig(
        { ...REQUIRED, ...PRODUCTION_POLICY, PAYPAL_CLIENT_SECRET: undefined },
        'production'
      )
    );
    assert.throws(() =>
      loadCheckoutConfig(
        { ...REQUIRED, ...PRODUCTION_POLICY, PAYPAL_ENVIRONMENT: 'sandbox' },
        'production'
      )
    );
    assert.throws(() => loadCheckoutConfig({ ...REQUIRED, PAYPAL_TIMEOUT_MS: '0' }, 'development'));
    assert.throws(() =>
      loadCheckoutConfig({ ...REQUIRED, PAYPAL_TIMEOUT_MS: '120001' }, 'development')
    );
  });

  it('rejects missing bindings and malformed or inconsistent limits', () => {
    assert.throws(() => loadCheckoutConfig({ ...REQUIRED, CHECKOUT_STORE_ID: ' ' }, 'development'));
    assert.throws(() =>
      loadCheckoutConfig({ ...REQUIRED, CHECKOUT_TAX_BASIS_POINTS: '8.5' }, 'development')
    );
    assert.throws(() =>
      loadCheckoutConfig({ ...REQUIRED, CHECKOUT_TAX_BASIS_POINTS: '10001' }, 'development')
    );
    assert.throws(() =>
      loadCheckoutConfig(
        {
          ...REQUIRED,
          CHECKOUT_MAX_ITEM_QUANTITY: '11',
          CHECKOUT_MAX_AGGREGATE_QUANTITY: '10',
        },
        'development'
      )
    );
    for (const [name, value] of [
      ['CHECKOUT_MAX_ITEM_QUANTITY', '10001'],
      ['CHECKOUT_MAX_AGGREGATE_QUANTITY', '50001'],
      ['CHECKOUT_MAX_TOTAL_MINOR_UNITS', '100000001'],
    ]) {
      assert.throws(() => loadCheckoutConfig({ ...REQUIRED, [name]: value }, 'development'));
    }
  });
});
