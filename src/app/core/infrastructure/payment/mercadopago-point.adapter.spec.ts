import { TestBed } from '@angular/core/testing';
import { MercadoPagoPointAdapter } from '@core/infrastructure/payment/mercadopago-point.adapter';
import type { PointChargeRequest } from '@core/application/ports/mercadopago-point.port';
import { CurrentUserService } from '@core/application/auth/current-user.service';

const REQUEST: PointChargeRequest = {
  amount: 24,
  externalReference: 'txn-123',
  terminalId: 'PAX_A910__SMARTPOS1234',
};

function reply(body: Record<string, unknown>, ok = true): Response {
  return { ok, json: () => Promise.resolve(body) } as unknown as Response;
}

function order(status: string, extra: Record<string, unknown> = {}): Response {
  return reply({ id: 'ORD1', status, externalReference: 'txn-123', paymentId: '', ...extra });
}

/** Lets pending microtask chains run without moving the fake clock. */
async function flush(): Promise<void> {
  await vi.advanceTimersByTimeAsync(0);
}

describe('MercadoPagoPointAdapter', () => {
  let adapter: MercadoPagoPointAdapter;
  let fetchMock: ReturnType<typeof vi.fn>;
  let session: { accessToken: string } | null;

  beforeEach(() => {
    vi.useFakeTimers();
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    session = { accessToken: 'staff-jwt' };
    TestBed.configureTestingModule({
      providers: [
        MercadoPagoPointAdapter,
        { provide: CurrentUserService, useValue: { session: () => session } },
      ],
    });
    adapter = TestBed.inject(MercadoPagoPointAdapter);
  });

  afterEach(() => {
    adapter.destroy();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('creates the order with the staff JWT, the sale id and the linked device', async () => {
    fetchMock.mockResolvedValueOnce(order('processed', { paymentId: 'PAY1' }));

    const result = await adapter.charge(REQUEST);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toMatch(/\/mercadopago\/point\/orders$/);
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer staff-jwt');
    expect(JSON.parse(init.body as string)).toEqual({
      amount: 24,
      externalReference: 'txn-123',
      terminalId: 'PAX_A910__SMARTPOS1234',
    });
    expect(result).toMatchObject({ status: 'approved', orderId: 'ORD1', paymentId: 'PAY1' });
  });

  it('reports at_terminal while waiting, then approves only on processed', async () => {
    const seen: string[] = [];
    fetchMock
      .mockResolvedValueOnce(order('created'))
      .mockResolvedValueOnce(order('at_terminal'))
      .mockResolvedValueOnce(order('processed', { paymentId: 'PAY1' }));

    const promise = adapter.charge(REQUEST, (s) => seen.push(s));
    await vi.advanceTimersByTimeAsync(4_000);
    const result = await promise;

    expect(seen).toEqual(['created', 'at_terminal']);
    expect(result.status).toBe('approved');
    expect(fetchMock.mock.calls[1][0]).toMatch(/\/orders\/ORD1$/);
  });

  it.each(['failed', 'expired', 'refunded'])('maps %s to rejected', async (status) => {
    fetchMock.mockResolvedValueOnce(order(status));
    expect((await adapter.charge(REQUEST)).status).toBe('rejected');
  });

  it('maps canceled to a confirmed cancel', async () => {
    fetchMock.mockResolvedValueOnce(order('canceled'));
    expect(await adapter.charge(REQUEST)).toMatchObject({
      status: 'cancelled',
      cancellationConfirmed: true,
    });
  });

  it('never auto-finalizes action_required', async () => {
    fetchMock.mockResolvedValueOnce(order('action_required'));
    expect((await adapter.charge(REQUEST)).status).toBe('needs-confirmation');
  });

  it('rejects without calling the gateway when nobody is signed in', async () => {
    session = null;
    expect(await adapter.charge(REQUEST)).toMatchObject({ status: 'rejected', orderId: '' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects when the order cannot be created', async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: 'x' }, false));
    expect(await adapter.charge(REQUEST)).toMatchObject({ status: 'rejected', orderId: '' });
  });

  it('ignores failed polls and keeps waiting instead of finalizing', async () => {
    fetchMock
      .mockResolvedValueOnce(order('at_terminal'))
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce(reply({ error: 'x' }, false))
      .mockResolvedValueOnce(order('processed', { paymentId: 'PAY1' }));

    const promise = adapter.charge(REQUEST);
    await vi.advanceTimersByTimeAsync(6_000);

    expect((await promise).status).toBe('approved');
  });

  it('settles an unconfirmed cancel when no final status arrives before the deadline', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(order('at_terminal')));

    const promise = adapter.charge(REQUEST);
    await vi.advanceTimersByTimeAsync(6 * 60_000 + 4_000);

    expect(await promise).toMatchObject({ status: 'cancelled', cancellationConfirmed: false });
  });

  describe('cancel()', () => {
    it('resolves cancelled when nothing is in flight', async () => {
      expect((await adapter.cancel()).status).toBe('cancelled');
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('settles cancelled when MP confirms the cancel', async () => {
      fetchMock
        .mockResolvedValueOnce(order('created'))
        .mockResolvedValueOnce(order('canceled', { pending: false }));

      const promise = adapter.charge(REQUEST);
      await flush();
      const cancelled = await adapter.cancel();

      expect(fetchMock.mock.calls[1][0]).toMatch(/\/orders\/ORD1\/cancel$/);
      expect(cancelled).toMatchObject({ status: 'cancelled', cancellationConfirmed: true });
      expect(await promise).toEqual(cancelled);
    });

    it('resolves approved when the buyer pays during the 202 cancel window', async () => {
      fetchMock
        .mockResolvedValueOnce(order('at_terminal'))
        .mockResolvedValueOnce(order('at_terminal', { pending: true }))
        .mockResolvedValueOnce(order('processed', { paymentId: 'PAY1' }));

      const promise = adapter.charge(REQUEST);
      await flush();
      const cancelling = adapter.cancel();
      await vi.advanceTimersByTimeAsync(2_000);

      expect((await cancelling).status).toBe('approved');
      expect((await promise).paymentId).toBe('PAY1');
    });

    it('keeps waiting up to a minute for the machine to act on a pending cancel', async () => {
      fetchMock
        .mockResolvedValueOnce(order('at_terminal'))
        .mockResolvedValueOnce(order('at_terminal', { pending: true }));

      const promise = adapter.charge(REQUEST);
      await flush();
      const cancelling = adapter.cancel();
      fetchMock.mockImplementation(() => Promise.resolve(order('at_terminal')));
      await vi.advanceTimersByTimeAsync(50_000);
      fetchMock.mockImplementation(() => Promise.resolve(order('canceled')));
      await vi.advanceTimersByTimeAsync(2_000);

      expect(await cancelling).toMatchObject({ status: 'cancelled', cancellationConfirmed: true });
      expect(await promise).toMatchObject({ status: 'cancelled', cancellationConfirmed: true });
    });

    it('asks the clerk to confirm when the machine never acts on the cancel within a minute', async () => {
      fetchMock.mockImplementation(() => Promise.resolve(order('at_terminal', { pending: true })));

      const promise = adapter.charge(REQUEST);
      await flush();
      const cancelling = adapter.cancel();
      await vi.advanceTimersByTimeAsync(62_000);

      expect((await cancelling).status).toBe('needs-confirmation');
      expect((await promise).status).toBe('needs-confirmation');
    });

    it('does not settle on failed polls during the cancel window', async () => {
      fetchMock
        .mockResolvedValueOnce(order('at_terminal'))
        .mockResolvedValueOnce(order('at_terminal', { pending: true }))
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(order('canceled'));

      const promise = adapter.charge(REQUEST);
      await flush();
      const cancelling = adapter.cancel();
      await vi.advanceTimersByTimeAsync(4_000);

      expect(await cancelling).toMatchObject({ status: 'cancelled', cancellationConfirmed: true });
      await promise;
    });

    it('counts an order that expires after a cancel request as a confirmed cancel', async () => {
      fetchMock
        .mockResolvedValueOnce(order('at_terminal'))
        .mockResolvedValueOnce(order('at_terminal', { pending: true }))
        .mockResolvedValueOnce(order('expired'));

      const promise = adapter.charge(REQUEST);
      await flush();
      const cancelling = adapter.cancel();
      await vi.advanceTimersByTimeAsync(2_000);

      expect(await cancelling).toMatchObject({ status: 'cancelled', cancellationConfirmed: true });
      await promise;
    });

    it('settles an unconfirmed cancel when the gateway cannot be reached', async () => {
      fetchMock.mockResolvedValueOnce(order('at_terminal')).mockRejectedValueOnce(new Error('x'));

      const promise = adapter.charge(REQUEST);
      await flush();
      await adapter.cancel();

      expect(await promise).toMatchObject({ status: 'cancelled', cancellationConfirmed: false });
    });
  });

  describe('destroy()', () => {
    it('settles a pending charge as an unconfirmed cancel and cancels the order', async () => {
      fetchMock.mockResolvedValue(order('at_terminal'));

      const promise = adapter.charge(REQUEST);
      await flush();
      adapter.destroy();

      expect(await promise).toMatchObject({ status: 'cancelled', cancellationConfirmed: false });
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/ORD1/cancel'))).toBe(true);
    });
  });
});
