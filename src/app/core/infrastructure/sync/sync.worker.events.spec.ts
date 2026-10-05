/**
 * The worker's half of the outbox drain (#359): `PUSH_EVENTS` → `POST /api/events`.
 *
 * What matters is what reaches the server and what comes back to the main thread,
 * and that answers the server cannot act on (401/403/404) never trip the circuit
 * breaker that also guards the product sync.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  DEFAULT_SYNC_CONFIG,
  PushEventPayload,
  SyncWorkerCommand,
  SyncWorkerConfig,
  SyncWorkerEvent,
} from './sync.types';

const TOKEN = 'header.payload.signature';
type Call = [string, RequestInit | undefined];
type Script = (url: string, init?: RequestInit) => Response | Promise<Response>;

const EVENT: PushEventPayload = {
  eventId: 'evt-1',
  type: 'sale.completed',
  correlationId: 'corr-1',
  payload: { transactionId: 'TXN-1', items: [] },
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Listeners each imported worker module attached to `self`. A fresh module per test
 * is how the worker's module state is reset, but its listeners outlive it, so they are
 * removed after every test, or an earlier test's worker would answer too.
 */
const attached: [string, EventListenerOrEventListenerObject][] = [];

/** Everything but `/api/events` answers like a healthy, empty pos-api. */
async function loadWorker(events: Script) {
  const add = self.addEventListener.bind(self);
  vi.spyOn(self, 'addEventListener').mockImplementation(((
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ) => {
    attached.push([type, listener]);
    add(type, listener, options);
  }) as typeof self.addEventListener);
  const calls: Call[] = [];
  const posted: SyncWorkerEvent[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url);
      calls.push([href, init]);
      if (href.endsWith('/api/events')) return events(href, init);
      if (href.includes('/products') && init?.method === 'POST') return json({}, 201);
      return json({ status: 'healthy', products: [], transactions: [] });
    })
  );
  vi.spyOn(self, 'postMessage').mockImplementation((event: unknown) => {
    posted.push(event as SyncWorkerEvent);
  });
  vi.resetModules();
  await import('./sync.worker');

  const send = (command: SyncWorkerCommand) =>
    self.dispatchEvent(new MessageEvent('message', { data: command }));
  const settle = () => new Promise((resolve) => setTimeout(resolve, 10));
  const replies = () =>
    posted.filter(
      (event): event is Extract<SyncWorkerEvent, { type: 'EVENTS_ACKED' | 'EVENTS_FAILED' }> =>
        event.type === 'EVENTS_ACKED' || event.type === 'EVENTS_FAILED'
    );
  const eventCalls = () => calls.filter(([url]) => url.endsWith('/api/events'));
  return { calls, posted, send, settle, replies, eventCalls };
}

/** Near-instant retries, and a sync interval that never fires a second tick. */
function config(sessionToken: string | undefined): SyncWorkerConfig {
  return {
    ...DEFAULT_SYNC_CONFIG,
    sessionToken,
    syncIntervalMs: 600_000,
    retry: { maxAttempts: 2, initialDelay: 1, maxDelay: 1, backoffMultiplier: 1 },
  };
}

async function started(events: Script, token: string | undefined = TOKEN) {
  const worker = await loadWorker(events);
  worker.send({ type: 'START_SYNC', config: config(token) });
  await worker.settle();
  return worker;
}

describe('sync worker PUSH_EVENTS (#359)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(console, 'info').mockImplementation(() => undefined);
  });

  afterEach(() => {
    for (const [type, listener] of attached.splice(0)) self.removeEventListener(type, listener);
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('POSTs the batch with the session token and reports the verdicts', async () => {
    const worker = await started(() =>
      json({ results: [{ eventId: 'evt-1', status: 'applied' }] })
    );

    worker.send({ type: 'PUSH_EVENTS', requestId: 'req-1', events: [EVENT] });
    await worker.settle();

    const [[url, init]] = worker.eventCalls();
    expect(url).toBe(`${DEFAULT_SYNC_CONFIG.apiBaseUrl}/api/events`);
    expect(init?.method).toBe('POST');
    expect((init?.headers as Record<string, string>)['Authorization']).toBe(`Bearer ${TOKEN}`);
    expect(JSON.parse(init?.body as string)).toEqual({ events: [EVENT] });
    expect(worker.replies()).toEqual([
      {
        type: 'EVENTS_ACKED',
        requestId: 'req-1',
        results: [{ eventId: 'evt-1', status: 'applied' }],
      },
    ]);
  });

  it('sends nothing without a session and says to retry later', async () => {
    // '' rather than undefined: undefined would fall back to started()'s default token.
    const worker = await started(() => json({ results: [] }), '');

    worker.send({ type: 'PUSH_EVENTS', requestId: 'req-anon', events: [EVENT] });
    await worker.settle();

    expect(worker.eventCalls()).toHaveLength(0);
    expect(worker.replies()).toEqual([
      expect.objectContaining({ type: 'EVENTS_FAILED', requestId: 'req-anon', retryLater: true }),
    ]);
  });

  it.each([401, 403, 404])('answers retry-later on %i', async (status) => {
    const worker = await started(() => json({ error: 'no' }, status));

    worker.send({ type: 'PUSH_EVENTS', requestId: 'req-1', events: [EVENT] });
    await worker.settle();

    expect(worker.replies()).toEqual([
      expect.objectContaining({ type: 'EVENTS_FAILED', retryLater: true }),
    ]);
  });

  it('never opens the circuit on 401s: the product sync still goes out afterwards', async () => {
    const worker = await started(() => json({ error: 'expired' }, 401));

    for (let i = 0; i < 8; i += 1) {
      worker.send({ type: 'PUSH_EVENTS', requestId: `req-${i}`, events: [EVENT] });
      await worker.settle();
    }
    worker.send({
      type: 'PUSH_PRODUCTS',
      products: [{ id: 'p1', name: 'Hay', price: 3, category: 'feed' }],
    });
    await worker.settle();

    expect(
      worker.calls.some(([url, init]) => url.endsWith('/api/products') && init?.method === 'POST')
    ).toBe(true);
    expect(worker.posted.some((event) => event.type === 'CIRCUIT_STATE_CHANGED')).toBe(false);
  });

  it('retries a 5xx, then reports a plain failure', async () => {
    const worker = await started(() => json({ error: 'boom' }, 503));

    worker.send({ type: 'PUSH_EVENTS', requestId: 'req-1', events: [EVENT] });
    await worker.settle();
    await worker.settle();

    expect(worker.eventCalls().length).toBeGreaterThan(1);
    expect(worker.replies()).toEqual([
      expect.objectContaining({ type: 'EVENTS_FAILED', requestId: 'req-1', retryLater: false }),
    ]);
  });

  it('reports a network failure as a plain failure', async () => {
    const worker = await started(() => {
      throw new TypeError('Failed to fetch');
    });

    worker.send({ type: 'PUSH_EVENTS', requestId: 'req-1', events: [EVENT] });
    await worker.settle();
    await worker.settle();

    expect(worker.replies()).toEqual([
      expect.objectContaining({ type: 'EVENTS_FAILED', retryLater: false }),
    ]);
  });
});
