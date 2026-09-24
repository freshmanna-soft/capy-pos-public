import { TestBed } from '@angular/core/testing';
import {
  RemoteTransactionFailedError,
  TransactionRemoteService,
} from './transaction-remote.service';
import { CartService } from '@core/application/services/cart.service';
import { PaymentResult } from '@features/pos-terminal/components/checkout/checkout.component';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const mockItems = [
  {
    product: { id: 'p-1', name: 'Burger', price: 12.5 },
    quantity: 2,
  },
];

function makeCartService() {
  return {
    items: vi.fn().mockReturnValue(mockItems),
    subtotal: vi.fn().mockReturnValue(25),
    tax: vi.fn().mockReturnValue(2.5),
    total: vi.fn().mockReturnValue(27.5),
  };
}

const paymentResult: PaymentResult = {
  method: 'cash',
  amount: 30,
  change: 2.5,
  transactionId: 'txn-001',
  timestamp: new Date('2024-01-01T12:00:00Z'),
};

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe('TransactionRemoteService', () => {
  let service: TransactionRemoteService;
  let cart: ReturnType<typeof makeCartService>;

  beforeEach(() => {
    cart = makeCartService();

    TestBed.configureTestingModule({
      providers: [TransactionRemoteService, { provide: CartService, useValue: cart }],
    });

    service = TestBed.inject(TransactionRemoteService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // ── getShopSessionToken ───────────────────────────────────────────────────

  it('returns the session token from sessionStorage', () => {
    sessionStorage.setItem('shop-session-token', 'jwt-abc');
    expect(service.getShopSessionToken()).toBe('jwt-abc');
    sessionStorage.removeItem('shop-session-token');
  });

  it('returns null when there is no session token', () => {
    sessionStorage.removeItem('shop-session-token');
    expect(service.getShopSessionToken()).toBeNull();
  });

  // ── persistTransaction — happy path ──────────────────────────────────────

  it('POSTs to /api/transactions with the correct body and resolves on 2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));

    await expect(
      service.persistTransaction(paymentResult, 'bearer-token')
    ).resolves.toBeUndefined();

    const [url, init] = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];

    expect(url).toContain('/transactions');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({ Authorization: 'Bearer bearer-token' });

    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsed.paymentMethod).toBe('cash');
    expect(parsed.total).toBe(27.5);
    expect(Array.isArray(parsed.items)).toBe(true);
  });

  it('includes customerId and customerEmail when provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));

    await service.persistTransaction(paymentResult, 'tok', 'cust-1', 'alice@example.com');

    const [, init] = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect(parsed.customerId).toBe('cust-1');
    expect(parsed.customerEmail).toBe('alice@example.com');
  });

  it('omits customerId and customerEmail when not provided', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 } as Response));

    await service.persistTransaction(paymentResult, 'tok');

    const [, init] = (vi.mocked(fetch) as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const parsed = JSON.parse(init.body as string) as Record<string, unknown>;
    expect('customerId' in parsed).toBe(false);
    expect('customerEmail' in parsed).toBe(false);
  });

  // ── persistTransaction — error paths ─────────────────────────────────────

  it('throws RemoteTransactionFailedError on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 } as Response));

    await expect(service.persistTransaction(paymentResult, 'tok')).rejects.toThrow(
      RemoteTransactionFailedError
    );
    await expect(service.persistTransaction(paymentResult, 'tok')).rejects.toThrow('HTTP 500');
  });

  it('throws RemoteTransactionFailedError when fetch rejects with an Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('ECONNREFUSED')));

    await expect(service.persistTransaction(paymentResult, 'tok')).rejects.toThrow(
      RemoteTransactionFailedError
    );
    await expect(service.persistTransaction(paymentResult, 'tok')).rejects.toThrow('ECONNREFUSED');
  });

  it('throws RemoteTransactionFailedError with "Network error" when fetch rejects with a non-Error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue('string error'));

    await expect(service.persistTransaction(paymentResult, 'tok')).rejects.toThrow('Network error');
  });
});
