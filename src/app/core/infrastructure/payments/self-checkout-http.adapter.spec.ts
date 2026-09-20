import { TestBed } from '@angular/core/testing';
import {
  CUSTOMER_AUTH_GATEWAY,
  CustomerAuthGateway,
} from '@core/application/auth/ports/customer-auth-gateway.port';
import { SelfCheckoutHttpAdapter } from './self-checkout-http.adapter';

const quote = {
  currency: 'USD' as const,
  taxRateBasisPoints: 850,
  lines: [
    {
      productId: 'product-1',
      productName: 'Coffee',
      quantity: 2,
      unitPriceMinorUnits: 450,
      subtotalMinorUnits: 900,
    },
  ],
  subtotalMinorUnits: 900,
  taxMinorUnits: 77,
  totalMinorUnits: 977,
};

const created = {
  checkoutId: 'checkout-1',
  paypalOrderId: 'order-1',
  checkoutToken: 'capability-1',
  state: 'awaiting-approval' as const,
  quote,
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('SelfCheckoutHttpAdapter', () => {
  let adapter: SelfCheckoutHttpAdapter;
  let auth: Pick<CustomerAuthGateway, 'getAccessToken'>;

  beforeEach(() => {
    auth = { getAccessToken: vi.fn().mockReturnValue(null) };
    TestBed.configureTestingModule({
      providers: [SelfCheckoutHttpAdapter, { provide: CUSTOMER_AUTH_GATEWAY, useValue: auth }],
    });
    adapter = TestBed.inject(SelfCheckoutHttpAdapter);
  });

  afterEach(() => vi.unstubAllGlobals());

  it('creates a checkout with only item identities and quantities', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(created));
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      adapter.create([{ productId: 'product-1', quantity: 2 }], 'idempotency-1')
    ).resolves.toEqual(created);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);
    expect(url).toBe('http://localhost:8790/api/self-checkout/checkouts');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body as string)).toEqual({
      items: [{ productId: 'product-1', quantity: 2 }],
    });
    expect(headers.get('Idempotency-Key')).toBe('idempotency-1');
    expect(headers.has('Authorization')).toBe(false);
  });

  it('adds the customer bearer without making it required', async () => {
    vi.mocked(auth.getAccessToken).mockReturnValue('customer-token');
    const fetchMock = vi.fn().mockResolvedValue(response(created));
    vi.stubGlobal('fetch', fetchMock);

    await adapter.create([{ productId: 'product-1', quantity: 2 }], 'idempotency-1');

    const headers = new Headers((fetchMock.mock.calls[0][1] as RequestInit).headers);
    expect(headers.get('Authorization')).toBe('Bearer customer-token');
  });

  it('uses the checkout capability for status and completion', async () => {
    const status = {
      checkoutId: 'checkout/1',
      state: 'awaiting-approval',
      quote,
      paypalOrderId: 'order-1',
      receipt: null,
      failure: null,
    };
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(response(status)));
    vi.stubGlobal('fetch', fetchMock);

    await adapter.status('checkout/1', 'capability-1');
    await adapter.complete('checkout/1', 'capability-1');

    expect(fetchMock.mock.calls.map((call) => call[0])).toEqual([
      'http://localhost:8790/api/self-checkout/checkouts/checkout%2F1',
      'http://localhost:8790/api/self-checkout/checkouts/checkout%2F1/complete',
    ]);
    for (const [, init] of fetchMock.mock.calls as [string, RequestInit][]) {
      expect(new Headers(init.headers).get('X-Checkout-Token')).toBe('capability-1');
    }
  });

  it('rejects a successful response with malformed authoritative facts', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ ...created, quote: {} })));

    await expect(
      adapter.create([{ productId: 'product-1', quantity: 2 }], 'idempotency-1')
    ).rejects.toMatchObject({
      code: 'invalid-server-response',
      ambiguous: true,
    });
  });

  it('classifies a network failure as ambiguous and retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));

    await expect(adapter.status('checkout-1', 'capability-1')).rejects.toMatchObject({
      code: 'network-error',
      retryable: true,
      ambiguous: true,
    });
  });

  it('preserves stable completion conflicts and marks an unresolved completion ambiguous', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ error: 'checkout-busy', retryable: true }, 409))
    );

    await expect(adapter.complete('checkout-1', 'capability-1')).rejects.toMatchObject({
      code: 'checkout-busy',
      retryable: true,
      ambiguous: true,
      status: 409,
    });
  });

  it('treats definite create conflicts such as out of stock as non-ambiguous', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ error: 'out-of-stock', retryable: false }, 409))
    );

    await expect(
      adapter.create([{ productId: 'product-1', quantity: 2 }], 'idempotency-1')
    ).rejects.toMatchObject({
      code: 'out-of-stock',
      retryable: false,
      ambiguous: false,
      status: 409,
    });
  });
});
