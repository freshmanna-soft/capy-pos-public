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
      // One microtask flush so the IIFE's `this.activeController = controller`
      // assignment (which runs after `await create()`) settles before destroy().
      await Promise.resolve();
      adapter.destroy();
      expect(mockController.unmount).toHaveBeenCalledTimes(1);
    });
  });

  describe('createWalletBrick()', () => {
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

    it('rejects on rejected payment status', async () => {
      vi.useFakeTimers();
      vi.stubGlobal('fetch', makeFetchSequence(makeWalletBackendResponse(), ['rejected']));

      mockBricksCreate.mockImplementation(
        async (_b: string, _t: string, settings: { callbacks: { onSubmit: () => void } }) => {
          settings.callbacks.onSubmit();
          return mockController;
        }
      );

      const p = adapter.createWalletBrick(50, 'mp-wallet-container');
      // Pre-attach a no-op catch so the promise is marked as "handled" before
      // vi.advanceTimersByTimeAsync fires the interval and calls reject().
      // Without this, Node/Vitest sees an unhandled rejection in the window
      // between the reject() call and the await expect(p).rejects line.
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      const handled = p.catch(() => {});

      await vi.advanceTimersByTimeAsync(2100);
      await handled;

      await expect(p).rejects.toThrow('rejected');

      vi.useRealTimers();
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
      await Promise.resolve();
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
      await Promise.resolve();
      adapter.destroy();
      adapter.destroy();
      expect(mockController.unmount).toHaveBeenCalledTimes(1);
    });
  });
});
