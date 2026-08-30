/**
 * Sync worker request authorization (issues #206, #224).
 *
 * #206 put an authorizer in front of every backend route except `GET /api/health`
 * and left the two halves disagreeing: the backend demanded `Authorization` and
 * this worker — the one client that talks to it — never sent the header. #224 then
 * settled *which* credential that header carries: IBM `pos-api` is the sync backend
 * and it verifies the operator's session JWT (`infra/pos-api/src/session-auth.ts`),
 * not `terraform/aws-demo`'s shared service token. The header mechanics are
 * identical; the value comes from `SyncSessionCredentialService` now instead of a
 * build-time constant.
 *
 * These are the assertions from the caller's side of the wire. They drive the real
 * worker through real `postMessage` commands and inspect what it hands `fetch`, so
 * "the client sends the token" is checked against the code that does the sending
 * rather than against a description of it.
 *
 * Three properties matter as much as the header itself:
 *
 *  - **Health stays unauthenticated.** It is the worker's connectivity probe and the
 *    one route no authorizer is attached to. Sending a credential there would turn a
 *    simple GET into a preflighted one and make the liveness signal depend on CORS
 *    and on the token being current — the probe has to keep working when the token
 *    is stale, which is precisely when you want to know the API is reachable.
 *  - **No token configured means no header**, not `Bearer undefined`. A malformed
 *    credential is denied the same way a wrong one is, so it presents as "the token
 *    is wrong" when the truth is "there is no token".
 *  - **No session means no authorized call at all.** The worker starts at app boot,
 *    before anyone has signed in, and `pos-api` answers 401 without a token. Pulling
 *    anyway would retry three times per tick and trip the circuit breaker, so the
 *    till's first sync after sign-in would sit behind an open circuit for a minute.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_SYNC_CONFIG,
  SyncWorkerCommand,
  SyncWorkerConfig,
  SyncWorkerEvent,
} from './sync.types';

/** Shaped like a session JWT because that is what it now is — see #224. */
const TOKEN = 'header.payload.signature';

/** Every `fetch` the worker made, as `[url, init]`. */
type Call = [string, RequestInit | undefined];

/**
 * Load a fresh copy of the worker with `fetch`, `postMessage` and the console
 * stubbed, and return handles for driving it.
 *
 * A fresh module per test is not optional: the worker keeps its config, circuit
 * breaker and `isSyncing` latch in module-scope state, so a second `START_SYNC`
 * against a cached module would inherit the previous test's token and a possibly
 * open circuit.
 */
async function loadWorker() {
  const calls: Call[] = [];
  const events: SyncWorkerEvent[] = [];

  const fetchStub = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push([String(url), init]);
    return new Response(JSON.stringify({ status: 'healthy', products: [] }), {
      status: url.toString().includes('/products') && init?.method === 'POST' ? 201 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchStub);
  vi.spyOn(self, 'postMessage').mockImplementation((event: unknown) => {
    events.push(event as SyncWorkerEvent);
  });

  vi.resetModules();
  await import('./sync.worker');

  const send = (command: SyncWorkerCommand) => {
    self.dispatchEvent(new MessageEvent('message', { data: command }));
  };

  return {
    calls,
    events,
    send,
    /** Every `PUSH_COMPLETED` the worker reported back to the main thread. */
    pushResults(): Extract<SyncWorkerEvent, { type: 'PUSH_COMPLETED' }>[] {
      return events.filter(
        (event): event is Extract<SyncWorkerEvent, { type: 'PUSH_COMPLETED' }> =>
          event.type === 'PUSH_COMPLETED'
      );
    },
    /** Authorization header the worker set on the call to `path`, if any. */
    authFor(path: string): string | undefined {
      const call = calls.find(([url]) => url.includes(path));
      const headers = (call?.[1]?.headers ?? {}) as Record<string, string>;
      return headers['Authorization'];
    },
    /** Wait for the worker's in-flight fetch chain to settle. */
    settle: () => new Promise((resolve) => setTimeout(resolve, 0)),
  };
}

/** A `START_SYNC` config with the given token, and an interval long enough to
 *  never fire a second cycle inside a test. */
function config(sessionToken: string | undefined): SyncWorkerConfig {
  return { ...DEFAULT_SYNC_CONFIG, sessionToken, syncIntervalMs: 600_000 };
}

describe('sync worker request authorization (#206, #224)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('with a session token configured', () => {
    it('sends the token on the products pull', async () => {
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config(TOKEN) });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.authFor('/api/products')).toBe(`Bearer ${TOKEN}`);
    });

    it('sends the token on the transactions pull', async () => {
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config(TOKEN) });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.authFor('/api/transactions')).toBe(`Bearer ${TOKEN}`);
    });

    it('does NOT send the token on the health probe', async () => {
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config(TOKEN) });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      const health = worker.calls.find(([url]) => url.includes('/api/health'));
      expect(health, 'the worker should probe health on start').toBeDefined();
      expect(worker.authFor('/api/health')).toBeUndefined();
    });

    it('sends the token when creating a product', async () => {
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config(TOKEN) });
      await worker.settle();
      worker.send({
        type: 'PUSH_PRODUCTS',
        products: [{ id: 'prod-1', name: 'Hay', price: 3, category: 'feed' }],
      });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      const post = worker.calls.find(([, init]) => init?.method === 'POST');
      expect((post?.[1]?.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${TOKEN}`
      );
      // The token must not displace the header the payload needs.
      expect((post?.[1]?.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json'
      );
    });

    it('sends the token when updating a product', async () => {
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config(TOKEN) });
      await worker.settle();
      worker.send({
        type: 'PUSH_UPDATE_PRODUCTS',
        products: [{ id: 'prod-1', name: 'Hay', price: 3, category: 'feed', stock: 9 }],
      });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      const patch = worker.calls.find(([, init]) => init?.method === 'PATCH');
      expect((patch?.[1]?.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${TOKEN}`
      );
      expect((patch?.[1]?.headers as Record<string, string>)['Content-Type']).toBe(
        'application/json'
      );
    });

    it('sends the token when deleting a product', async () => {
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config(TOKEN) });
      await worker.settle();
      worker.send({ type: 'PUSH_DELETE_PRODUCTS', productIds: ['prod-1'] });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      const del = worker.calls.find(([, init]) => init?.method === 'DELETE');
      expect((del?.[1]?.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${TOKEN}`
      );
    });

    it('picks up a token supplied later via UPDATE_CONFIG', async () => {
      // The whole reason UPDATE_CONFIG carries it: the worker starts at app boot and
      // the operator signs in afterwards, so the credential always arrives late.
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config('') });
      await worker.settle();
      worker.send({ type: 'UPDATE_CONFIG', config: { sessionToken: TOKEN } });
      worker.send({ type: 'FORCE_SYNC' });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      const authorized = worker.calls.filter(
        ([url, init]) =>
          url.includes('/api/products') &&
          (init?.headers as Record<string, string>)?.['Authorization'] === `Bearer ${TOKEN}`
      );
      expect(authorized.length).toBeGreaterThan(0);
    });
  });

  describe('with no session token configured', () => {
    it.each([
      ['an empty string', ''],
      ['whitespace only', '   '],
      ['undefined', undefined],
    ])('omits the header entirely when the token is %s', async (_case, token) => {
      // Never `Bearer undefined` — a malformed credential is a denial that reads
      // like a wrong token, which is a worse thing to debug than no credential.
      // The guards below mean no authorized request goes out at all in this state;
      // this asserts the second line of defence, so that a future caller reaching
      // `authHeaders` on an unguarded path still cannot emit a malformed credential.
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config(token) });
      await worker.settle();
      worker.send({ type: 'PUSH_DELETE_PRODUCTS', productIds: ['prod-1'] });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.calls, 'the health probe should still have run').not.toHaveLength(0);
      for (const [, init] of worker.calls) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(Object.keys(headers)).not.toContain('Authorization');
      }
    });

    it('skips the pull entirely rather than 401ing its way to an open circuit', async () => {
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config('') });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.calls.some(([url]) => url.includes('/api/products'))).toBe(false);
      expect(worker.calls.some(([url]) => url.includes('/api/transactions'))).toBe(false);
    });

    it('still probes health, so the connectivity signal survives being signed out', async () => {
      // The login screen shows whether the backend is reachable; that has to stay
      // true before anyone holds a credential.
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config(undefined) });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.calls.some(([url]) => url.includes('/api/health'))).toBe(true);
    });

    // The pull guard's siblings. Every authorized write is as unauthorized as the
    // pull is before sign-in, and each 401 would count against the same breaker
    // (threshold 5) — so a couple of unauthenticated pushes would leave the circuit
    // open and stall the till's first real sync after sign-in.
    it.each([
      [
        'create',
        {
          type: 'PUSH_PRODUCTS',
          products: [{ id: 'p1', name: 'Hay', price: 3, category: 'feed' }],
        },
        'POST',
      ],
      [
        'update',
        {
          type: 'PUSH_UPDATE_PRODUCTS',
          products: [{ id: 'p1', name: 'Hay', price: 3, category: 'feed', stock: 9 }],
        },
        'PATCH',
      ],
      ['delete', { type: 'PUSH_DELETE_PRODUCTS', productIds: ['p1'] }, 'DELETE'],
    ] as const)('sends no %s request without a session', async (_verb, command, method) => {
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config('') });
      await worker.settle();
      worker.send(command as SyncWorkerCommand);
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.calls.some(([, init]) => init?.method === method)).toBe(false);
    });

    it('reports the refused push as failed instead of leaving the caller hanging', async () => {
      // `SyncService.pushUpdateAsync` awaits a PUSH_COMPLETED keyed by product id.
      // Skipping silently the way the pull does would strand that promise until its
      // own 20s timeout, which then rejects with "timed out" — blaming the network
      // for a missing session. The worker has to settle it, with the real reason.
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config('') });
      await worker.settle();
      worker.send({
        type: 'PUSH_UPDATE_PRODUCTS',
        products: [
          { id: 'p1', name: 'Hay', price: 3, category: 'feed' },
          { id: 'p2', name: 'Oats', price: 4, category: 'feed' },
        ],
      });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      const [report] = worker.pushResults();
      expect(report, 'the worker must answer the push').toBeDefined();
      expect(report.pushed).toBe(0);
      expect(report.failed).toBe(2);
      // Keyed per product, because that is how the pending promises are looked up —
      // a single aggregate failure would settle neither.
      expect(report.results.map((r) => r.productId)).toEqual(['p1', 'p2']);
      for (const result of report.results) {
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/session/i);
      }
    });

    it('pushes normally once a token arrives', async () => {
      // Same deferral-not-latch property the pull has: the refusal must not outlive
      // the sign-in that follows it.
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config('') });
      await worker.settle();
      worker.send({ type: 'UPDATE_CONFIG', config: { sessionToken: TOKEN } });
      worker.send({
        type: 'PUSH_PRODUCTS',
        products: [{ id: 'p1', name: 'Hay', price: 3, category: 'feed' }],
      });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      const post = worker.calls.find(([, init]) => init?.method === 'POST');
      expect(post, 'the push should go out once authorized').toBeDefined();
      expect((post?.[1]?.headers as Record<string, string>)['Authorization']).toBe(
        `Bearer ${TOKEN}`
      );
    });

    it('pulls as soon as a token arrives', async () => {
      // The skip is a deferral, not a latch: the sign-in that follows boot has to
      // start syncing without waiting for the next tick.
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config('') });
      await worker.settle();
      expect(worker.calls.some(([url]) => url.includes('/api/products'))).toBe(false);

      worker.send({ type: 'UPDATE_CONFIG', config: { sessionToken: TOKEN } });
      worker.send({ type: 'FORCE_SYNC' });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      expect(worker.authFor('/api/products')).toBe(`Bearer ${TOKEN}`);
    });
  });
});
