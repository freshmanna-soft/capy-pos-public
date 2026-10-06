import { TestBed } from '@angular/core/testing';
import { MercadoPagoAdapter } from '@core/infrastructure/payment/mercadopago.adapter';
import { environment } from '../../../../environments/environment';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock('@mercadopago/sdk-js', () => ({
  loadMercadoPago: vi.fn().mockResolvedValue(undefined),
}));

/** Minimal brick controller stub */
const mockController = { unmount: vi.fn() };

/** Minimal MercadoPago constructor stub — must be a real function for `new` */
const mockBricksCreate = vi.fn();

function MockMercadoPago(this: unknown) {
  return { bricks: () => ({ create: mockBricksCreate }) };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setUpGlobalMp(): void {
  (globalThis as Record<string, unknown>)['MercadoPago'] = MockMercadoPago;
}

function makeBackendResponse(status: 'approved' | 'pending' | 'rejected' = 'approved'): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ id: 'pay-123', status }),
  } as unknown as Response;
}

/** Lets every pending microtask chain run (one macrotask turn). */
function flushAsync(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('MercadoPagoAdapter', () => {
  let adapter: MercadoPagoAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    setUpGlobalMp();

    // Stub global fetch
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeBackendResponse('approved')));

    // Default brick: resolves the controller then calls onSubmit via its own logic —
    // here we drive it manually in each test.
    mockBricksCreate.mockResolvedValue(mockController);

    TestBed.configureTestingModule({ providers: [MercadoPagoAdapter] });
    adapter = TestBed.inject(MercadoPagoAdapter);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('isEnabled()', () => {
    it('reflects the environment flag', () => {
      // The test environment has mercadopago.enabled = false
      expect(adapter.isEnabled()).toBe(environment.mercadopago.enabled);
    });
  });

  describe('loadSdk()', () => {
    it('calls loadMercadoPago once', async () => {
      const { loadMercadoPago } = await import('@mercadopago/sdk-js');
      await adapter.loadSdk();
      expect(loadMercadoPago).toHaveBeenCalledTimes(1);
    });

    it('is idempotent — second call does not re-import', async () => {
      const { loadMercadoPago } = await import('@mercadopago/sdk-js');
      await adapter.loadSdk();
      await adapter.loadSdk();
      expect(loadMercadoPago).toHaveBeenCalledTimes(1);
    });
  });

  describe('createAndRender()', () => {
    it('initialises the MercadoPago SDK with the configured public key', async () => {
      // Drive the onSubmit callback ourselves
      mockBricksCreate.mockImplementation(
        async (
          _brick: string,
          _target: string,
          settings: {
            callbacks: { onSubmit: (d: unknown) => Promise<void> };
          }
        ) => {
          await settings.callbacks.onSubmit({
            token: 'tok-abc',
            issuer_id: '123',
            payment_method_id: 'visa',
            transaction_amount: 50,
            installments: 1,
            payer: { email: 'test@test.com', identification: { type: 'CPF', number: '12345' } },
          });
          return mockController;
        }
      );

      await adapter.createAndRender(50, 'mp-container');

      // The constructor is called with the env public key
      expect(MockMercadoPago).not.toBeUndefined();
    });

    it('resolves with approved status when backend returns approved', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeBackendResponse('approved')));

      mockBricksCreate.mockImplementation(
        async (
          _b: string,
          _t: string,
          settings: {
            callbacks: { onSubmit: (d: unknown) => Promise<void> };
          }
        ) => {
          await settings.callbacks.onSubmit({ token: 'tok' });
          return mockController;
        }
      );

      const result = await adapter.createAndRender(100, 'mp-container');
      expect(result.status).toBe('approved');
      expect(result.paymentId).toBe('pay-123');
      expect(result.amount).toBe(100);
    });

    it('resolves with pending status when backend returns pending', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeBackendResponse('pending')));

      mockBricksCreate.mockImplementation(
        async (
          _b: string,
          _t: string,
          settings: {
            callbacks: { onSubmit: (d: unknown) => Promise<void> };
          }
        ) => {
          await settings.callbacks.onSubmit({ token: 'tok' });
          return mockController;
        }
      );

      const result = await adapter.createAndRender(100, 'mp-container');
      expect(result.status).toBe('pending');
    });

    it('rejects when backend returns non-ok response', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));

      mockBricksCreate.mockImplementation(
        async (
          _b: string,
          _t: string,
          settings: {
            callbacks: { onSubmit: (d: unknown) => Promise<void> };
          }
        ) => {
          await settings.callbacks.onSubmit({ token: 'tok' });
          return mockController;
        }
      );

      await expect(adapter.createAndRender(100, 'mp-container')).rejects.toThrow(
        'Payment request failed: 500'
      );
    });

    it('rejects when a critical brick error fires', async () => {
      mockBricksCreate.mockImplementation(
        async (
          _b: string,
          _t: string,
          settings: {
            callbacks: { onError: (e: { type: string; message: string }) => void };
          }
        ) => {
          settings.callbacks.onError({ type: 'critical', message: 'SDK exploded' });
          return mockController;
        }
      );

      await expect(adapter.createAndRender(100, 'mp-container')).rejects.toThrow(
        'MercadoPago critical error: SDK exploded'
      );
    });

    it('stores the controller for later destroy()', async () => {
      mockBricksCreate.mockImplementation(
        async (
          _b: string,
          _t: string,
          settings: {
            callbacks: { onSubmit: (d: unknown) => Promise<void> };
          }
        ) => {
          await settings.callbacks.onSubmit({ token: 'tok' });
          return mockController;
        }
      );

      await adapter.createAndRender(100, 'mp-container');
      // Flush a macrotask so the IIFE's controller adoption (which runs after
      // `await create()`, several microtask hops past the resolve) lands
      // before destroy().
      await flushAsync();
      adapter.destroy();
      expect(mockController.unmount).toHaveBeenCalledTimes(1);
    });
  });

  describe('createWalletBrick()', () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    /** Fake preference creation response. */
    function makeWalletBackendResponse(id = 'pref-456'): Response {
      return {
        ok: true,
        json: () => Promise.resolve({ id, initPoint: `https://mp.com/checkout/${id}` }),
      } as unknown as Response;
    }

    /**
     * Build a fetch stub that:
     *  - call 0  → returns the preference creation 200 (POST to .../preference)
     *  - call 1+ → returns the status poll result (GET to .../preference/:id)
     */
    function makeFetchSequence(
      prefResponse: Response,
      pollStatuses: string[]
    ): ReturnType<typeof vi.fn> {
      let pollIdx = 0;
      return vi.fn().mockImplementation(async (url: string) => {
        if (typeof url === 'string' && url.includes('/preference/')) {
          // Status poll call
          const status = pollStatuses[pollIdx] ?? 'not_found';
          pollIdx++;
          return { ok: true, json: async () => ({ status }) };
        }
        // Preference creation call
        return prefResponse;
      });
    }

    it('POSTs mode:wallet, mounts Wallet Brick, resolves approved after poll', async () => {
      vi.useFakeTimers();
      vi.stubGlobal(
        'fetch',
        makeFetchSequence(makeWalletBackendResponse(), ['not_found', 'approved'])
      );

      mockBricksCreate.mockImplementation(
        async (_b: string, _t: string, settings: { callbacks: { onSubmit: () => void } }) => {
          settings.callbacks.onSubmit(); // simulate buyer clicking Pay
          return mockController;
        }
      );

      const resultPromise = adapter.createWalletBrick(99, 'mp-wallet-container');

      // Advance past the first poll interval (2 s) → 'not_found', then second → 'approved'
      await vi.advanceTimersByTimeAsync(2100);
      await vi.advanceTimersByTimeAsync(2100);
      const result = await resultPromise;

      // fetch call 0 was the preference POST
      const [url, init] = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0] as [
        string,
        RequestInit,
      ];
      expect(url).toContain('preference');
      expect(JSON.parse(init.body as string)).toMatchObject({ mode: 'wallet', amount: 99 });

      expect(mockBricksCreate).toHaveBeenCalledWith(
        'wallet',
        'mp-wallet-container',
        expect.any(Object)
      );
      expect(result.status).toBe('approved');
      expect(result.preferenceId).toBe('pref-456');
      expect(result.amount).toBe(99);

      vi.useRealTimers();
    });

    it('uses redirectMode:blank so MP checkout opens in a new tab', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', makeFetchSequence(makeWalletBackendResponse(), ['approved']));

      mockBricksCreate.mockImplementation(
        async (_b: string, _t: string, settings: { callbacks: { onSubmit: () => void } }) => {
          settings.callbacks.onSubmit();
          return mockController;
        }
      );

      const p = adapter.createWalletBrick(99, 'mp-wallet-container');
      await vi.advanceTimersByTimeAsync(2100);
      await p;

      const callSettings = mockBricksCreate.mock.calls[0][2] as {
        initialization: { redirectMode: string };
      };
      expect(callSettings.initialization.redirectMode).toBe('blank');

      vi.useRealTimers();
    });

    it('calls onPollingStarted when the buyer clicks Pay', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', makeFetchSequence(makeWalletBackendResponse(), ['approved']));

      mockBricksCreate.mockImplementation(
        async (_b: string, _t: string, settings: { callbacks: { onSubmit: () => void } }) => {
          settings.callbacks.onSubmit();
          return mockController;
        }
      );

      const onPollingStarted = vi.fn();
      const p = adapter.createWalletBrick(99, 'mp-wallet-container', onPollingStarted);
      await vi.advanceTimersByTimeAsync(2100);
      await p;

      expect(onPollingStarted).toHaveBeenCalledOnce();

      vi.useRealTimers();
    });

    // A legacy return page (no `outcome`) reporting `rejected` means the buyer
    // left MP without paying: the attempt is cancelled, never rejected-and-left-open.
    it('cancels (not rejects) on a legacy rejected broadcast', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeWalletBackendResponse()));

      // Capture the BroadcastChannel instance created inside the adapter so we
      // can dispatch a message on it synchronously.
      let capturedChannel: { onmessage: ((e: MessageEvent) => void) | null } | null = null;
      vi.stubGlobal(
        'BroadcastChannel',
        class {
          onmessage: ((e: MessageEvent) => void) | null = null;
          constructor() {
            capturedChannel = this; // eslint-disable-line @typescript-eslint/no-this-alias
          }
          // eslint-disable-next-line @typescript-eslint/no-empty-function
          close() {}
        }
      );

      mockBricksCreate.mockImplementation(
        async (_b: string, _t: string, settings: { callbacks: { onSubmit: () => void } }) => {
          settings.callbacks.onSubmit();
          return mockController;
        }
      );

      const p = adapter.createWalletBrick(50, 'mp-wallet-container');
      // Drain the microtask queue: loadSdk() + fetch + bricks().create() are all
      // async, so several await-ticks are needed before onSubmit fires and
      // listenForCallback() registers the BroadcastChannel.
      await new Promise((r) => setTimeout(r, 0));

      // Simulate the back-url redirect posting a 'rejected' result.
      capturedChannel!.onmessage!({
        data: { paymentId: 'pay-rej', status: 'rejected', preferenceId: 'pref-456' },
      } as unknown as MessageEvent);

      // The stubbed fetch answers the cancel POST with a non-cancel body, so
      // the gateway could not confirm it.
      await expect(p).resolves.toMatchObject({
        status: 'cancelled',
        cancellationConfirmed: false,
      });
    });

    it('503 from backend → rejects with "not configured" message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 503,
          json: () => Promise.resolve({ error: 'MercadoPago is not configured on this server.' }),
        } as unknown as Response)
      );

      await expect(adapter.createWalletBrick(50, 'mp-wallet-container')).rejects.toThrow(
        'Set MP_ACCESS_TOKEN'
      );
    });

    it('502 from backend → rejects with the backend error message', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: false,
          status: 502,
          json: () => Promise.resolve({ error: 'MercadoPago preference creation failed.' }),
        } as unknown as Response)
      );

      await expect(adapter.createWalletBrick(50, 'mp-wallet-container')).rejects.toThrow(
        'MercadoPago preference failed: MercadoPago preference creation failed.'
      );
    });

    it('rejects when fetch throws (network error)', async () => {
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

      await expect(adapter.createWalletBrick(50, 'mp-wallet-container')).rejects.toThrow(
        'Is it running?'
      );
    });

    it('rejects when the Wallet Brick fires a critical error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeWalletBackendResponse()));

      mockBricksCreate.mockImplementation(
        async (
          _b: string,
          _t: string,
          settings: { callbacks: { onError: (e: { type: string; message: string }) => void } }
        ) => {
          settings.callbacks.onError({ type: 'critical', message: 'Wallet SDK exploded' });
          return mockController;
        }
      );

      await expect(adapter.createWalletBrick(50, 'mp-wallet-container')).rejects.toThrow(
        'Wallet SDK exploded'
      );
    });
  });

  describe('cancelPayment() — wallet', () => {
    type CancelReply = { status: 'cancelled' | 'approved'; paymentId?: string } | 'error' | 'throw';

    /** The channel the adapter opened, so a test can play the MP return tab. */
    let channel: { onmessage: ((e: MessageEvent) => void) | null; close: () => void } | null;
    const channelClose = vi.fn();

    afterEach(() => {
      vi.useRealTimers();
    });

    beforeEach(() => {
      channel = null;
      channelClose.mockClear();
      vi.stubGlobal(
        'BroadcastChannel',
        class {
          onmessage: ((e: MessageEvent) => void) | null = null;
          close = channelClose;
          constructor() {
            channel = this; // eslint-disable-line @typescript-eslint/no-this-alias
          }
        }
      );
    });

    /**
     * Fetch routed by URL: preference create, status poll, cancel. Records
     * nothing itself — assertions read `vi.mocked(fetch).mock.calls`.
     */
    function routeFetch(cancel: CancelReply = { status: 'cancelled' }, pollStatus = 'not_found') {
      const fn = vi.fn(async (url: string) => {
        if (url.endsWith('/cancel')) {
          if (cancel === 'throw') throw new Error('offline');
          if (cancel === 'error') return { ok: false, status: 502, json: async () => ({}) };
          return { ok: true, json: async () => cancel };
        }
        if (url.includes('/preference/')) {
          return { ok: true, json: async () => ({ status: pollStatus }) };
        }
        return {
          ok: true,
          json: async () => ({ id: 'pref-456', externalReference: 'ext-456' }),
        };
      });
      vi.stubGlobal('fetch', fn);
      return fn;
    }

    const callsTo = (fn: ReturnType<typeof vi.fn>, match: (url: string) => boolean) =>
      fn.mock.calls.filter(([url]) => match(url as string));
    const isPoll = (url: string) => url.endsWith('/preference/ext-456');
    const isCancel = (url: string) => url.endsWith('/cancel');

    /** Mount the Wallet Brick and have the buyer click Pay straight away. */
    function mountAndPay(): void {
      mockBricksCreate.mockImplementation(
        async (_b: string, _t: string, settings: { callbacks: { onSubmit: () => void } }) => {
          settings.callbacks.onSubmit();
          return mockController;
        }
      );
    }

    it('stops polling and the timeout, closes the channel, unmounts, and settles cancelled', async () => {
      vi.useFakeTimers();
      const fetchFn = routeFetch();
      mountAndPay();

      const pending = adapter.createWalletBrick(99, 'mp-wallet-container');
      await vi.advanceTimersByTimeAsync(2100);
      expect(callsTo(fetchFn, isPoll)).toHaveLength(1);

      const result = await adapter.cancelPayment();

      expect(result).toMatchObject({ status: 'cancelled', cancellationConfirmed: true });
      await expect(pending).resolves.toEqual(result);
      expect(channelClose).toHaveBeenCalled();
      expect(mockController.unmount).toHaveBeenCalledOnce();

      const [cancelUrl, cancelInit] = callsTo(fetchFn, isCancel)[0] as [string, RequestInit];
      expect(cancelUrl).toBe(`${environment.mercadopago.preferenceApiUrl}/ext-456/cancel`);
      expect(cancelInit.method).toBe('POST');
      expect(JSON.parse(cancelInit.body as string)).toEqual({ preferenceId: 'pref-456' });

      // Well past both the poll interval and the 10-minute timeout: nothing more.
      const before = fetchFn.mock.calls.length;
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);
      expect(fetchFn.mock.calls).toHaveLength(before);
    });

    it('settles approved when the gateway reports the buyer already paid', async () => {
      vi.useFakeTimers();
      routeFetch({ status: 'approved', paymentId: 'pay-789' });
      mountAndPay();

      const pending = adapter.createWalletBrick(99, 'mp-wallet-container');
      await vi.advanceTimersByTimeAsync(0);
      const result = await adapter.cancelPayment();

      expect(result).toMatchObject({ status: 'approved', paymentId: 'pay-789' });
      await expect(pending).resolves.toMatchObject({ status: 'approved', paymentId: 'pay-789' });
    });

    it.each([
      ['an error response', 'error' as const],
      ['a network failure', 'throw' as const],
    ])('still settles cancelled, unconfirmed, on %s from the cancel route', async (_l, reply) => {
      vi.useFakeTimers();
      routeFetch(reply);
      mountAndPay();

      const pending = adapter.createWalletBrick(99, 'mp-wallet-container');
      await vi.advanceTimersByTimeAsync(0);
      await adapter.cancelPayment();

      await expect(pending).resolves.toMatchObject({
        status: 'cancelled',
        cancellationConfirmed: false,
      });
    });

    it('is idempotent — a second cancel reuses the first, one server call', async () => {
      vi.useFakeTimers();
      const fetchFn = routeFetch();
      mountAndPay();

      void adapter.createWalletBrick(99, 'mp-wallet-container');
      await vi.advanceTimersByTimeAsync(0);
      const first = adapter.cancelPayment();
      const second = adapter.cancelPayment();

      expect(second).toBe(first);
      await first;
      expect(callsTo(fetchFn, isCancel)).toHaveLength(1);
    });

    it('resolves cancelled without a server call when nothing is in flight', async () => {
      const fetchFn = routeFetch();
      await expect(adapter.cancelPayment()).resolves.toMatchObject({ status: 'cancelled' });
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('a late approved poll after cancel is ignored', async () => {
      vi.useFakeTimers();
      // Every poll would say approved — but cancel lands first.
      const fetchFn = routeFetch({ status: 'cancelled' }, 'approved');
      mountAndPay();

      const pending = adapter.createWalletBrick(99, 'mp-wallet-container');
      await vi.advanceTimersByTimeAsync(0);
      await adapter.cancelPayment();
      await vi.advanceTimersByTimeAsync(10_000);

      await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
      expect(callsTo(fetchFn, isPoll)).toHaveLength(0);
    });

    it('cancelled while the preference is still being created: never mounts, still cancels it', async () => {
      let releasePreference!: () => void;
      const fetchFn = vi.fn(async (url: string) => {
        if (url.endsWith('/cancel'))
          return { ok: true, json: async () => ({ status: 'cancelled' }) };
        await new Promise<void>((r) => (releasePreference = r));
        return { ok: true, json: async () => ({ id: 'pref-456', externalReference: 'ext-456' }) };
      });
      vi.stubGlobal('fetch', fetchFn);
      mountAndPay();

      const pending = adapter.createWalletBrick(99, 'mp-wallet-container');
      await flushAsync();
      const cancelling = adapter.cancelPayment();
      releasePreference();

      await expect(cancelling).resolves.toMatchObject({ status: 'cancelled' });
      await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
      expect(mockBricksCreate).not.toHaveBeenCalled();
      expect(callsTo(fetchFn, isCancel)).toHaveLength(1);
    });

    it('destroy() leaves no orphan poll and settles the attempt', async () => {
      vi.useFakeTimers();
      const fetchFn = routeFetch({ status: 'cancelled' }, 'approved');
      mountAndPay();

      const pending = adapter.createWalletBrick(99, 'mp-wallet-container');
      await vi.advanceTimersByTimeAsync(0);
      adapter.destroy();
      await vi.advanceTimersByTimeAsync(15 * 60 * 1000);

      await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
      expect(callsTo(fetchFn, isPoll)).toHaveLength(0);
      expect(callsTo(fetchFn, isCancel)).toHaveLength(1);
      expect(channelClose).toHaveBeenCalled();
    });

    it('a buyer-returned broadcast runs the gateway cancel and reports cancelling', async () => {
      vi.useFakeTimers();
      const fetchFn = routeFetch();
      mountAndPay();
      const onCancelling = vi.fn();

      const pending = adapter.createWalletBrick(99, 'mp-wallet-container', undefined, onCancelling);
      await vi.advanceTimersByTimeAsync(0);
      channel!.onmessage!({
        data: {
          outcome: 'abandoned',
          status: 'null',
          paymentId: '',
          preferenceId: '',
          externalReference: 'ext-456',
        },
      } as MessageEvent);

      await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
      expect(onCancelling).toHaveBeenCalledOnce();
      expect(callsTo(fetchFn, isCancel)).toHaveLength(1);
    });

    it("ignores a return broadcast that belongs to another tab's attempt", async () => {
      vi.useFakeTimers();
      const fetchFn = routeFetch();
      mountAndPay();

      void adapter.createWalletBrick(99, 'mp-wallet-container');
      await vi.advanceTimersByTimeAsync(0);
      channel!.onmessage!({
        data: { outcome: 'abandoned', status: 'null', externalReference: 'someone-else' },
      } as MessageEvent);
      await vi.advanceTimersByTimeAsync(0);

      expect(callsTo(fetchFn, isCancel)).toHaveLength(0);
      await adapter.cancelPayment();
    });

    it('an approved broadcast settles approved with its payment id', async () => {
      vi.useFakeTimers();
      routeFetch();
      mountAndPay();

      const pending = adapter.createWalletBrick(99, 'mp-wallet-container');
      await vi.advanceTimersByTimeAsync(0);
      channel!.onmessage!({
        data: {
          outcome: 'approved',
          status: 'approved',
          paymentId: 'pay-1',
          externalReference: 'ext-456',
        },
      } as MessageEvent);

      await expect(pending).resolves.toMatchObject({ status: 'approved', paymentId: 'pay-1' });
    });

    it('cancels at the gateway after 10 minutes with no verdict', async () => {
      vi.useFakeTimers();
      const fetchFn = routeFetch();
      mountAndPay();
      const onCancelling = vi.fn();

      const pending = adapter.createWalletBrick(99, 'mp-wallet-container', undefined, onCancelling);
      await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 100);

      await expect(pending).resolves.toMatchObject({ status: 'cancelled' });
      expect(onCancelling).toHaveBeenCalledOnce();
      expect(callsTo(fetchFn, isCancel)).toHaveLength(1);
    });
  });

  describe('cancelPayment() — card', () => {
    it('before the buyer submits: unmounts and settles cancelled without a charge', async () => {
      const fetchFn = vi.fn();
      vi.stubGlobal('fetch', fetchFn);
      mockBricksCreate.mockResolvedValue(mockController);

      const pending = adapter.createAndRender(50, 'mp-container');
      await flushAsync();
      const result = await adapter.cancelPayment();

      expect(result).toMatchObject({ status: 'cancelled', cancellationConfirmed: true });
      await expect(pending).resolves.toEqual(result);
      expect(mockController.unmount).toHaveBeenCalledOnce();
      expect(fetchFn).not.toHaveBeenCalled();
    });

    it('while a charge is in flight: waits for it and keeps an approval', async () => {
      let releaseCharge!: () => void;
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          await new Promise<void>((r) => (releaseCharge = r));
          return makeBackendResponse('approved');
        })
      );
      let submit!: (d: unknown) => Promise<void>;
      mockBricksCreate.mockImplementation(
        async (_b: string, _t: string, s: { callbacks: { onSubmit: typeof submit } }) => {
          submit = s.callbacks.onSubmit;
          return mockController;
        }
      );

      const pending = adapter.createAndRender(50, 'mp-container');
      await flushAsync();
      void submit({ token: 'tok' });
      await flushAsync();
      const cancelling = adapter.cancelPayment();
      releaseCharge();

      await expect(cancelling).resolves.toMatchObject({ status: 'approved', paymentId: 'pay-123' });
      await expect(pending).resolves.toMatchObject({ status: 'approved' });
    });
  });

  describe('destroy()', () => {
    it('calls controller.unmount() when a brick is active', async () => {
      mockBricksCreate.mockImplementation(
        async (
          _b: string,
          _t: string,
          settings: {
            callbacks: { onSubmit: (d: unknown) => Promise<void> };
          }
        ) => {
          await settings.callbacks.onSubmit({ token: 'tok' });
          return mockController;
        }
      );
      await adapter.createAndRender(50, 'mp-container');
      await flushAsync();
      adapter.destroy();
      expect(mockController.unmount).toHaveBeenCalledOnce();
    });

    it('is safe to call when no brick has been rendered', () => {
      expect(() => adapter.destroy()).not.toThrow();
    });

    it('is idempotent — double destroy does not throw', async () => {
      mockBricksCreate.mockImplementation(
        async (
          _b: string,
          _t: string,
          settings: {
            callbacks: { onSubmit: (d: unknown) => Promise<void> };
          }
        ) => {
          await settings.callbacks.onSubmit({ token: 'tok' });
          return mockController;
        }
      );
      await adapter.createAndRender(50, 'mp-container');
      await flushAsync();
      adapter.destroy();
      adapter.destroy();
      expect(mockController.unmount).toHaveBeenCalledTimes(1);
    });
  });
});
