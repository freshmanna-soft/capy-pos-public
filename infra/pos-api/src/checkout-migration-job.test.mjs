import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
process.env.NODE_ENV = 'test';
const { runCheckoutMigrationJob } = await import('./checkout-migration-job.ts');
process.env.NODE_ENV = ORIGINAL_NODE_ENV;

function response(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('checkout migration job', () => {
  it('runs with Cloudant-only configuration and logs non-secret migration metadata', async () => {
    const originalFetch = globalThis.fetch;
    const logs = [];
    const calls = [];
    globalThis.fetch = async (target) => {
      calls.push(String(target));
      if (String(target) === 'https://iam.cloud.ibm.com/identity/token') {
        return response(200, { access_token: 'token', expires_in: 3600 });
      }
      if (String(target).endsWith('/_index')) {
        return response(200, {
          result: 'created',
          id: '_design/checkout-due',
          name: 'by-kind-next-action-id',
        });
      }
      return response(200, { docs: [] });
    };

    try {
      await runCheckoutMigrationJob(
        {
          CLOUDANT_URL: 'https://cloudant.example',
          CLOUDANT_APIKEY: 'do-not-log-cloudant-key',
          CLOUDANT_CHECKOUTS_DB: 'checkouts',
        },
        (message, details) => logs.push([message, details])
      );
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(calls.length, 3);
    assert.deepEqual(logs, [
      [
        '[pos-api] checkout migration complete',
        {
          database: 'checkouts',
          designDocument: 'checkout-due',
          index: 'by-kind-next-action-id',
          outcome: 'created',
        },
      ],
    ]);
    assert.doesNotMatch(JSON.stringify(logs), /do-not-log-cloudant-key/);
  });
});
