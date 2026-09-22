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
