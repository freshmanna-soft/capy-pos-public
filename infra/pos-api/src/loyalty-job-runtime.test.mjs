import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildLoyaltyJobRuntime } from './loyalty-job-runtime.ts';

const ENV = {
  CLOUDANT_URL: 'https://cloudant.example/',
  CLOUDANT_APIKEY: 'cloudant-key',
  CLOUDANT_CHECKOUTS_DB: 'checkout_test',
  CLOUDANT_CUSTOMER_PROFILES_DB: 'profiles_test',
  CLOUDANT_LOYALTY_LEDGER_DB: 'ledger_test',
};

describe('loyalty job runtime', () => {
  it('builds a production runtime using only Cloudant configuration', () => {
    const runtime = buildLoyaltyJobRuntime(ENV, () => '2027-01-15T10:00:00.000Z');
    assert.ok(runtime.dueCheckouts);
    assert.ok(runtime.reconciler);
    assert.deepEqual(Object.keys(runtime).sort(), ['dueCheckouts', 'reconciler']);
  });

  it('requires Cloudant credentials and validates all database names', () => {
    assert.throws(() => buildLoyaltyJobRuntime({}, () => ''), /CLOUDANT_URL/);
    assert.throws(
      () => buildLoyaltyJobRuntime({ CLOUDANT_URL: 'https://cloudant.example' }, () => ''),
      /CLOUDANT_APIKEY/
    );
    for (const key of [
      'CLOUDANT_CHECKOUTS_DB',
      'CLOUDANT_CUSTOMER_PROFILES_DB',
      'CLOUDANT_LOYALTY_LEDGER_DB',
    ]) {
      assert.throws(
        () => buildLoyaltyJobRuntime({ ...ENV, [key]: '../x' }, () => ''),
        /database name/
      );
    }
  });
});
