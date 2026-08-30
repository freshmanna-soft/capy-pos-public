/**
 * Sync worker request authorization (issue #206).
 *
 * #206 put a shared-token authorizer in front of every `terraform/aws-demo` route
 * except `GET /api/health`. That change was server-side only, which left the two
 * halves disagreeing: the gateway now demands `Authorization` and this worker — the
 * one client that talks to it — never sent the header. Restanding the stack would
 * have 401d every pull and every push while the Terraform specs stayed green,
 * because they assert the *declaration* and never the caller.
 *
 * These are the assertions from the other side of the wire. They drive the real
 * worker through real `postMessage` commands and inspect what it hands `fetch`, so
 * "the client sends the token" is checked against the code that does the sending
 * rather than against a description of it.
 *
 * Two properties matter as much as the header itself:
 *
 *  - **Health stays unauthenticated.** It is the worker's connectivity probe and
 *    the one route the authorizer is not attached to. Sending a credential there
 *    would turn a simple GET into a preflighted one and make the liveness signal
 *    depend on CORS and on the token being current — the probe has to keep working
 *    when the token is stale, which is precisely when you want to know the API is
 *    reachable.
 *  - **No token configured means no header**, not `Bearer undefined`. The token is
 *    empty in every checked-in environment (a shared secret in a browser bundle is
 *    readable by every visitor, so it is injected, not committed), and that
 *    unconfigured state has to behave exactly as it did before this change.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DEFAULT_SYNC_CONFIG, SyncWorkerCommand, SyncWorkerConfig } from './sync.types';

const TOKEN = 'sk-capy-b9tQ2m4XvR7pLdN1';

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

  const fetchStub = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push([String(url), init]);
    return new Response(JSON.stringify({ status: 'healthy', products: [] }), {
      status: url.toString().includes('/products') && init?.method === 'POST' ? 201 : 200,
      headers: { 'Content-Type': 'application/json' },
    });
  });

  vi.stubGlobal('fetch', fetchStub);
  vi.spyOn(self, 'postMessage').mockImplementation(() => undefined);

  vi.resetModules();
  await import('./sync.worker');

  const send = (command: SyncWorkerCommand) => {
    self.dispatchEvent(new MessageEvent('message', { data: command }));
  };

  return {
    calls,
    send,
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
function config(serviceToken: string | undefined): SyncWorkerConfig {
  return { ...DEFAULT_SYNC_CONFIG, serviceToken, syncIntervalMs: 600_000 };
}

describe('sync worker request authorization (#206)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('with a service token configured', () => {
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
      // The token is injected at runtime rather than compiled in, so it can arrive
      // after the worker has already started.
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config('') });
      await worker.settle();
      worker.send({ type: 'UPDATE_CONFIG', config: { serviceToken: TOKEN } });
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

  describe('with no service token configured', () => {
    it.each([
      ['an empty string', ''],
      ['whitespace only', '   '],
      ['undefined', undefined],
    ])('omits the header entirely when the token is %s', async (_case, token) => {
      // Never `Bearer undefined` — a malformed credential is a denial that reads
      // like a wrong token, which is a worse thing to debug than no credential.
      const worker = await loadWorker();
      worker.send({ type: 'START_SYNC', config: config(token) });
      await worker.settle();
      worker.send({ type: 'PUSH_DELETE_PRODUCTS', productIds: ['prod-1'] });
      await worker.settle();
      worker.send({ type: 'STOP_SYNC' });

      for (const [, init] of worker.calls) {
        const headers = (init?.headers ?? {}) as Record<string, string>;
        expect(Object.keys(headers)).not.toContain('Authorization');
      }
    });
  });
});
