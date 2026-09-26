import { TestBed } from '@angular/core/testing';
import { PayPalAdapter } from '@core/infrastructure/payment/paypal.adapter';
import { environment } from '../../../../environments/environment';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

/** Minimal PayPal Buttons widget stub */
const mockWidget = {
  render: vi.fn<[], Promise<void>>(),
  close: vi.fn<[], Promise<void>>(),
};

/** Capture the config passed to paypal.Buttons() so tests can invoke callbacks */
let capturedConfig: {
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onError: (err: unknown) => void;
  onCancel: () => void;
} | null = null;

function setUpGlobalPayPal(): void {
  (globalThis as Record<string, unknown>)['paypal'] = {
    Buttons: vi.fn((config: typeof capturedConfig) => {
      capturedConfig = config;
      return mockWidget;
    }),
  };
}

function makeBackendOrderResponse(id = 'order-abc-123'): Response {
  return {
    ok: true,
    json: () => Promise.resolve({ id, status: 'CREATED' }),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PayPalAdapter', () => {
  let adapter: PayPalAdapter;

  beforeEach(() => {
    vi.clearAllMocks();
    capturedConfig = null;
    mockWidget.render.mockResolvedValue(undefined);
    mockWidget.close.mockResolvedValue(undefined);

    setUpGlobalPayPal();

    // Default fetch stub returns a successful order response
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeBackendOrderResponse()));

    TestBed.configureTestingModule({ providers: [PayPalAdapter] });
    adapter = TestBed.inject(PayPalAdapter);
    // Mark SDK as already loaded so we don't try to inject a real script tag.
    (adapter as unknown as Record<string, unknown>)['sdkLoaded'] = true;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -------------------------------------------------------------------------
  // isEnabled()
  // -------------------------------------------------------------------------

  describe('isEnabled()', () => {
    it('reflects the environment paypal.enabled flag', () => {
      expect(adapter.isEnabled()).toBe(environment.paypal.enabled);
    });
  });

  // -------------------------------------------------------------------------
  // loadSdk()
  // -------------------------------------------------------------------------

  describe('loadSdk()', () => {
    it('is idempotent — skips script injection when already loaded', async () => {
      // sdkLoaded is already true from beforeEach; a real <script> would throw
      // in jsdom. Calling it should resolve without touching the DOM.
      const appendChildSpy = vi.spyOn(document.head, 'appendChild');
      await adapter.loadSdk();
      expect(appendChildSpy).not.toHaveBeenCalled();
    });

    it('is idempotent when window.paypal already exists', async () => {
      (adapter as unknown as Record<string, unknown>)['sdkLoaded'] = false;
      const appendChildSpy = vi.spyOn(document.head, 'appendChild');
      await adapter.loadSdk(); // window.paypal is set from beforeEach
      expect(appendChildSpy).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // createAndRender()
  // -------------------------------------------------------------------------

  describe('createAndRender()', () => {
    it('calls paypal.Buttons() and renders into the given container', async () => {
      const resultPromise = adapter.createAndRender(50, 'paypal-btn-container');
      // Flush the loadSdk() microtask so Buttons() has been called
      await Promise.resolve();

      // Simulate user approving the order
      await capturedConfig!.onApprove({ orderID: 'order-abc-123' });
      const result = await resultPromise;

      expect(mockWidget.render).toHaveBeenCalledWith('#paypal-btn-container');
      expect(result.status).toBe('completed');
      expect(result.orderId).toBe('order-abc-123');
      expect(result.amount).toBe(50);
    });

    it('POSTs to preferenceApiUrl when createOrder is invoked', async () => {
      adapter.createAndRender(75, 'paypal-btn-container');
      await Promise.resolve(); // flush loadSdk() microtask

      const orderId = await capturedConfig!.createOrder();

      expect(fetch).toHaveBeenCalledWith(
        environment.paypal.preferenceApiUrl,
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: 75 }),
        })
      );
      expect(orderId).toBe('order-abc-123');
    });

    it('resolves with status "failed" when the buyer cancels', async () => {
      const resultPromise = adapter.createAndRender(100, 'paypal-btn-container');
      await Promise.resolve(); // flush loadSdk() microtask

      capturedConfig!.onCancel();
      const result = await resultPromise;

      expect(result.status).toBe('failed');
      expect(result.orderId).toBe('');
    });

    it('rejects when onError is called with an Error', async () => {
      const resultPromise = adapter.createAndRender(100, 'paypal-btn-container');
      await Promise.resolve(); // flush loadSdk() microtask

      capturedConfig!.onError(new Error('SDK error'));

      await expect(resultPromise).rejects.toThrow('SDK error');
    });

    it('rejects when onError is called with a non-Error value', async () => {
      const resultPromise = adapter.createAndRender(100, 'paypal-btn-container');
      await Promise.resolve(); // flush loadSdk() microtask

      capturedConfig!.onError('something went wrong');

      await expect(resultPromise).rejects.toThrow('PayPal payment error');
    });

    it('rejects when the backend returns a non-OK response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({ ok: false, status: 500 } as unknown as Response)
      );

      const resultPromise = adapter.createAndRender(100, 'paypal-btn-container');
      await Promise.resolve(); // flush loadSdk() microtask

      await expect(capturedConfig!.createOrder()).rejects.toThrow(
        'PayPal order creation failed: 500'
      );

      // Reject the outer promise too so we don't have unhandled rejections.
      capturedConfig!.onError(new Error('PayPal order creation failed: 500'));
      await expect(resultPromise).rejects.toThrow('PayPal order creation failed: 500');
    });

    it('rejects when buttons.render() rejects', async () => {
      mockWidget.render.mockRejectedValueOnce(new Error('render failed'));

      await expect(adapter.createAndRender(50, 'paypal-btn-container')).rejects.toThrow(
        'render failed'
      );
    });

    it('stores the timestamp as a Date instance on approval', async () => {
      const resultPromise = adapter.createAndRender(30, 'paypal-btn-container');
      await Promise.resolve(); // flush loadSdk() microtask

      await capturedConfig!.onApprove({ orderID: 'ts-test' });
      const result = await resultPromise;

      expect(result.timestamp).toBeInstanceOf(Date);
    });
  });

  // -------------------------------------------------------------------------
  // destroy()
  // -------------------------------------------------------------------------

  describe('destroy()', () => {
    it('calls close() on the active widget', async () => {
      const resultPromise = adapter.createAndRender(50, 'paypal-btn-container');
      await Promise.resolve(); // flush loadSdk() so activeWidget is set

      adapter.destroy();

      expect(mockWidget.close).toHaveBeenCalledTimes(1);
      // Resolve to avoid unhandled rejection warning
      capturedConfig!.onCancel();
      await resultPromise;
    });

    it('is a no-op when no widget is active', () => {
      expect(() => adapter.destroy()).not.toThrow();
    });

    it('clears activeWidget so a second destroy() is a no-op', async () => {
      const resultPromise = adapter.createAndRender(50, 'paypal-btn-container');
      await Promise.resolve(); // flush loadSdk() so activeWidget is set

      adapter.destroy();
      adapter.destroy(); // second call must not throw

      expect(mockWidget.close).toHaveBeenCalledTimes(1);
      capturedConfig!.onCancel();
      await resultPromise;
    });
  });
});
