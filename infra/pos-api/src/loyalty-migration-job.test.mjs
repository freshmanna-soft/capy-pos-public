import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const { runLoyaltyMigrationJob } = await import('./loyalty-migration-job.ts');
process.env.NODE_ENV = ORIGINAL_NODE_ENV;

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('loyalty migration job', () => {
  it('uses Cloudant-only config and logs no credentials', async () => {
    const originalFetch = globalThis.fetch;
    const logs = [];
    const calls = [];
    globalThis.fetch = async (target, init = {}) => {
      calls.push({ url: String(target), init });
      if (String(target) === 'https://iam.cloud.ibm.com/identity/token') {
        assert.match(String(init.body), /do-not-log-cloudant-key/);
        return response(200, { access_token: 'token', expires_in: 3600 });
      }
      if (String(target).endsWith('/loyalty-ledger/_index')) {
        return response(200, {
          result: 'created',
          id: '_design/loyalty-ledger-customer-sequence',
          name: 'by-customer-sequence-id',
        });
      }
      if (String(target).endsWith('/checkouts/_index')) {
        return response(200, {
          result: 'created',
          id: '_design/checkout-loyalty-due',
          name: 'by-kind-state-loyalty-status-next-action-id',
        });
      }
      return response(200, { docs: [] });
    };

    try {
      await runLoyaltyMigrationJob(
        {
          CLOUDANT_URL: 'https://cloudant.example',
          CLOUDANT_APIKEY: 'do-not-log-cloudant-key',
          CLOUDANT_CHECKOUTS_DB: 'checkouts',
          CLOUDANT_LOYALTY_LEDGER_DB: 'loyalty-ledger',
        },
        (message, details) => logs.push([message, details])
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 6);
    assert.deepEqual(logs, [
      [
        '[pos-api] loyalty migration complete',
        {
          indexes: [
            {
              database: 'loyalty-ledger',
              designDocument: 'loyalty-ledger-customer-sequence',
              index: 'by-customer-sequence-id',
              outcome: 'created',
            },
            {
              database: 'checkouts',
              designDocument: 'checkout-loyalty-due',
              index: 'by-kind-state-loyalty-status-next-action-id',
              outcome: 'created',
            },
          ],
        },
      ],
    ]);
    assert.doesNotMatch(JSON.stringify(logs), /do-not-log-cloudant-key/);
  });

  it('requires both Cloudant credentials and validates database names', async () => {
    await assert.rejects(runLoyaltyMigrationJob({}), /CLOUDANT_URL is required/);
    await assert.rejects(
      runLoyaltyMigrationJob({ CLOUDANT_URL: 'https://cloudant.example' }),
      /CLOUDANT_APIKEY is required/
    );
    await assert.rejects(
      runLoyaltyMigrationJob({
        CLOUDANT_URL: 'https://cloudant.example',
        CLOUDANT_APIKEY: 'key',
        CLOUDANT_LOYALTY_LEDGER_DB: 'bad database',
      }),
      /database name/
    );
  });
});
