/**
 * Sync worker resilience paths (issue #206 follow-on).
 *
 * The worker had no unit tests at all, which is why #206's server-side change could
 * land with the client half missing and every suite still green. Adding
 * `sync.worker.spec.ts` put the file under measurement for the first time and
 * exposed how much of it was never exercised: the circuit breaker, the retry
 * classifier and every push failure path.
 *
 * That is not incidental to the authorization work. Turning on the authorizer makes
 * **401 a live, expected failure mode** for the first time — a blank, stale or
 * wrong token now produces one on every call. Whether the worker retries a 401
 * therefore stops being a hypothetical: retrying means three requests per product
 * per cycle against a gateway that will refuse all of them, on a 30-second timer,
 * plus a circuit breaker tripped by a fault no backoff can fix. `isRetryable`
 * already excludes 401 — these tests are what keep it excluded, and they are the
 * reason the earlier reviews could say "401 is non-retryable" and point at a line
 * number rather than at a test.
 *
 * Fetch is stubbed per test; the worker's real circuit breaker and retry run
 * unmodified, with delays and thresholds shrunk through its own config so the suite
 * does not sit through exponential backoff.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_SYNC_CONFIG,
  SyncWorkerCommand,
  SyncWorkerConfig,
  SyncWorkerEvent,
  SyncStatus,
  WorkerCircuitState,
} from './sync.types';

/** A JSON response with the given status. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 401 ? 'Unauthorized' : 'OK',
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Load a fresh worker whose `fetch` is `impl`, capturing everything it posts back
 * to the main thread.
 *
 * Module-scope state (config, circuit breaker, `isSyncing`) makes a per-test module
 * mandatory — a circuit left open by one test would short-circuit the next.
 */
async function loadWorker(impl: (url: string, init?: RequestInit) => Promise<Response>) {
  const events: SyncWorkerEvent[] = [];
  const urls: string[] = [];

  const fetchStub = vi.fn(async (url: string | URL, init?: RequestInit) => {
    urls.push(String(url));
    return impl(String(url), init);
  });

  vi.stubGlobal('fetch', fetchStub);
  vi.spyOn(self, 'postMessage').mockImplementation(((event: SyncWorkerEvent) => {
    events.push(event);
    return undefined;
  }) as typeof self.postMessage);

  vi.resetModules();
  await import('./sync.worker');

  return {
    events,
    urls,
    fetchStub,
    send: (command: SyncWorkerCommand) =>
      self.dispatchEvent(new MessageEvent('message', { data: command })),
    /** Every posted event of the given type. */
    ofType: <T extends SyncWorkerEvent['type']>(type: T) =>
      events.filter((event): event is Extract<SyncWorkerEvent, { type: T }> => event.type === type),
    /** Drain pending timers and microtasks until the worker goes quiet. */
    async settle(ticks = 12) {
      for (let i = 0; i < ticks; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
      }
    },
  };
}

/** A config with near-zero backoff so retries resolve inside a test. */
function config(overrides: Partial<SyncWorkerConfig> = {}): SyncWorkerConfig {
  return {
    ...DEFAULT_SYNC_CONFIG,
    syncIntervalMs: 600_000,
    retry: { maxAttempts: 3, initialDelay: 1, maxDelay: 2, backoffMultiplier: 1 },
    circuitBreaker: {
      failureThreshold: 2,
      successThreshold: 1,
      timeout: 600_000,
      monitoringPeriod: 600_000,
    },
    ...overrides,
  };
}

describe('sync worker resilience (#206)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('a 401 is not retried', () => {
    it('makes exactly one products request when the token is rejected', async () => {
      // The whole point. With the authorizer on, a blank or stale token 401s every
      // call; retrying would triple the load on a gateway that is refusing us and
      // would trip the circuit breaker on a fault backoff cannot clear.
      const worker = await loadWorker(async (url) =>
        url.includes('/api/health') ? json({ status: 'healthy' }) : json({ message: 'nope' }, 401)
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      const productCalls = worker.urls.filter((url) => url.includes('/api/products'));
      expect(productCalls).toHaveLength(1);
    });

    it('does not emit a retry notice for a 401', async () => {
      const worker = await loadWorker(async (url) =>
        url.includes('/api/health') ? json({ status: 'healthy' }) : json({}, 401)
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      // SYNC_FAILED is only posted between retry attempts, so its absence is the
      // observable form of "we gave up immediately".
      expect(worker.ofType('SYNC_FAILED')).toHaveLength(0);
      expect(worker.ofType('ERROR').length + worker.ofType('SYNC_STATUS').length).toBeGreaterThan(
        0
      );
    });

    it('fails a product push once rather than three times', async () => {
      const worker = await loadWorker(async (url, init) =>
        url.includes('/api/health') || init?.method === undefined
          ? json({ status: 'healthy', products: [] })
          : json({}, 401)
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      const before = worker.urls.length;
      worker.send({
        type: 'PUSH_PRODUCTS',
        products: [{ id: 'prod-1', name: 'Hay', price: 3, category: 'feed' }],
      });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.urls.length - before).toBe(1);
      const [completed] = worker.ofType('PUSH_COMPLETED');
      expect(completed).toMatchObject({ pushed: 0, failed: 1 });
      expect(completed.results[0].error).toContain('401');
    });
  });

  describe('a 5xx is retried', () => {
    it('retries the products pull up to maxAttempts and reports each attempt', async () => {
      const worker = await loadWorker(async (url) =>
        url.includes('/api/health') ? json({ status: 'healthy' }) : json({}, 503)
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.urls.filter((url) => url.includes('/api/products'))).toHaveLength(3);
      // One notice per gap between attempts.
      expect(worker.ofType('SYNC_FAILED')).toHaveLength(2);
    });

    it('succeeds on a later attempt without surfacing an error', async () => {
      let attempt = 0;
      const worker = await loadWorker(async (url) => {
        if (url.includes('/api/health')) return json({ status: 'healthy' });
        if (url.includes('/api/transactions')) return json({ transactions: [] });
        attempt++;
        return attempt === 1 ? json({}, 500) : json({ products: [{ id: 'p1' }] });
      });

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('SYNC_COMPLETED')).toHaveLength(1);
      expect(worker.ofType('PRODUCTS_SYNCED')[0].products).toHaveLength(1);
    });
  });

  describe('circuit breaker', () => {
    it('opens after the failure threshold and reports CIRCUIT_OPEN', async () => {
      const worker = await loadWorker(async (url) =>
        url.includes('/api/health') ? json({ status: 'healthy' }) : json({}, 503)
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'FORCE_SYNC' });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      const opened = worker
        .ofType('CIRCUIT_STATE_CHANGED')
        .some((event) => event.state === WorkerCircuitState.OPEN);
      expect(opened).toBe(true);

      const statuses = worker.ofType('SYNC_STATUS').map((event) => event.status.status);
      expect(statuses).toContain(SyncStatus.CIRCUIT_OPEN);
    });

    it('closes again on RESET_CIRCUIT_BREAKER', async () => {
      const worker = await loadWorker(async (url) =>
        url.includes('/api/health') ? json({ status: 'healthy' }) : json({}, 503)
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'FORCE_SYNC' });
      await worker.settle();
      worker.send({ type: 'RESET_CIRCUIT_BREAKER' });
      worker.send({ type: 'GET_STATUS' });
      worker.send({ type: 'STOP_SYNC' });

      const latest = worker.ofType('SYNC_STATUS').at(-1);
      expect(latest?.status.circuitState).toBe(WorkerCircuitState.CLOSED);
    });
  });

  describe('health probe', () => {
    it('reports unhealthy when the probe throws', async () => {
      const worker = await loadWorker(async (url) => {
        if (url.includes('/api/health')) throw new TypeError('Failed to fetch');
        return json({ products: [] });
      });

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('HEALTH_CHECK')[0]).toMatchObject({ healthy: false });
    });

    it('reports healthy and echoes the base URL it probed', async () => {
      const worker = await loadWorker(async () => json({ status: 'healthy', products: [] }));

      worker.send({ type: 'START_SYNC', config: config({ apiBaseUrl: 'https://api.example.test' }) });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('HEALTH_CHECK')[0]).toMatchObject({
        healthy: true,
        apiUrl: 'https://api.example.test',
      });
    });
  });

  describe('push result reporting', () => {
    it('treats 409 on create as success — the product is already there', async () => {
      const worker = await loadWorker(async (url, init) =>
        init?.method === 'POST' ? json({}, 409) : json({ status: 'healthy', products: [] })
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({
        type: 'PUSH_PRODUCTS',
        products: [{ id: 'prod-1', name: 'Hay', price: 3, category: 'feed' }],
      });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('PUSH_COMPLETED')[0]).toMatchObject({ pushed: 1, failed: 0 });
    });

    it('treats 404 on delete as success — an idempotent delete', async () => {
      const worker = await loadWorker(async (url, init) =>
        init?.method === 'DELETE' ? json({}, 404) : json({ status: 'healthy', products: [] })
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'PUSH_DELETE_PRODUCTS', productIds: ['prod-1'] });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('PUSH_COMPLETED')[0]).toMatchObject({ pushed: 1, failed: 0 });
    });

    it('carries the X-Trace-Id back with a failed update so it can be traced', async () => {
      const worker = await loadWorker(async (url, init) => {
        if (init?.method !== 'PATCH') return json({ status: 'healthy', products: [] });
        return new Response('{}', { status: 400, headers: { 'X-Trace-Id': 'trace-abc' } });
      });

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({
        type: 'PUSH_UPDATE_PRODUCTS',
        products: [{ id: 'prod-1', name: 'Hay', price: 3, category: 'feed' }],
      });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('PUSH_COMPLETED')[0].results[0]).toMatchObject({
        productId: 'prod-1',
        success: false,
        traceId: 'trace-abc',
      });
    });

    it('ignores the backend’s "unavailable" trace sentinel', async () => {
      const worker = await loadWorker(async (url, init) => {
        if (init?.method !== 'PATCH') return json({ status: 'healthy', products: [] });
        return new Response('{}', { status: 200, headers: { 'X-Trace-Id': 'unavailable' } });
      });

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({
        type: 'PUSH_UPDATE_PRODUCTS',
        products: [{ id: 'prod-1', name: 'Hay', price: 3, category: 'feed' }],
      });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('PUSH_COMPLETED')[0].results[0].traceId).toBeUndefined();
    });

    it('posts nothing for an empty push batch', async () => {
      const worker = await loadWorker(async () => json({ status: 'healthy', products: [] }));

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'PUSH_PRODUCTS', products: [] });
      worker.send({ type: 'PUSH_UPDATE_PRODUCTS', products: [] });
      worker.send({ type: 'PUSH_DELETE_PRODUCTS', productIds: [] });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('PUSH_COMPLETED')).toHaveLength(0);
    });
  });

  describe('response shapes', () => {
    it.each([
      ['a bare array', [{ id: 'p1' }, { id: 'p2' }]],
      ['a products envelope', { products: [{ id: 'p1' }, { id: 'p2' }] }],
      ['a DynamoDB Items envelope', { Items: [{ id: 'p1' }, { id: 'p2' }] }],
    ])('reads products from %s', async (_case, body) => {
      const worker = await loadWorker(async (url) =>
        url.includes('/api/products') ? json(body) : json({ status: 'healthy' })
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('PRODUCTS_SYNCED')[0].products).toHaveLength(2);
    });

    it('survives a transactions failure without failing the whole cycle', async () => {
      // Transactions are explicitly non-fatal: the catalog is what the till needs.
      const worker = await loadWorker(async (url) =>
        url.includes('/api/transactions') ? json({}, 401) : json({ products: [{ id: 'p1' }] })
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('SYNC_COMPLETED')).toHaveLength(1);
      expect(worker.ofType('SYNC_COMPLETED')[0].data.transactionsSynced).toBe(0);
    });
  });

  describe('config updates', () => {
    it('applies a new sync interval without restarting the worker', async () => {
      const worker = await loadWorker(async () => json({ status: 'healthy', products: [] }));

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'UPDATE_CONFIG', config: { syncIntervalMs: 900_000 } });
      worker.send({ type: 'GET_STATUS' });
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.ofType('SYNC_STATUS').at(-1)?.status.nextSyncIn).toBe(900_000);
    });

    it('forwards circuit breaker and retry overrides', async () => {
      const worker = await loadWorker(async (url) =>
        url.includes('/api/health') ? json({ status: 'healthy' }) : json({}, 503)
      );

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({
        type: 'UPDATE_CONFIG',
        config: {
          retry: { maxAttempts: 1, initialDelay: 1, maxDelay: 1, backoffMultiplier: 1 },
          circuitBreaker: {
            failureThreshold: 99,
            successThreshold: 1,
            timeout: 1,
            monitoringPeriod: 1,
          },
        },
      });
      const before = worker.urls.length;
      worker.send({ type: 'RESET_CIRCUIT_BREAKER' });
      worker.send({ type: 'FORCE_SYNC' });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      // maxAttempts: 1 means a single products call, no retries.
      const after = worker.urls.slice(before).filter((url) => url.includes('/api/products'));
      expect(after).toHaveLength(1);
    });

    it('reports IDLE with no interval once stopped', async () => {
      const worker = await loadWorker(async () => json({ status: 'healthy', products: [] }));

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });
      worker.send({ type: 'GET_STATUS' });

      const latest = worker.ofType('SYNC_STATUS').at(-1);
      expect(latest?.status).toMatchObject({ status: SyncStatus.IDLE, nextSyncIn: undefined });
    });
  });

  describe('concurrency', () => {
    it('skips a FORCE_SYNC that lands while a cycle is already running', async () => {
      let release: (() => void) | undefined;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });

      const worker = await loadWorker(async (url) => {
        if (url.includes('/api/health')) return json({ status: 'healthy' });
        if (url.includes('/api/products')) {
          await gate;
          return json({ products: [] });
        }
        return json({ transactions: [] });
      });

      worker.send({ type: 'START_SYNC', config: config() });
      await worker.settle(2);
      worker.send({ type: 'FORCE_SYNC' });
      await worker.settle(2);

      // The second cycle must not have issued its own products request.
      expect(worker.urls.filter((url) => url.includes('/api/products'))).toHaveLength(1);

      release?.();
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });
    });
  });
});
