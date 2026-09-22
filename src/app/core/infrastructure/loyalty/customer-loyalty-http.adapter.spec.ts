import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { CustomerLoyaltyHttpAdapter } from './customer-loyalty-http.adapter';

const projection = {
  status: 'available',
  pointsBalance: 1250,
  tier: 'silver',
  policyVersion: 'self-checkout-usd-v1',
  updatedAt: '2027-01-15T10:00:00.000Z',
};

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('CustomerLoyaltyHttpAdapter', () => {
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [CustomerLoyaltyHttpAdapter] });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('loads only the current bearer subject without accepting a customer id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(projection));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = TestBed.inject(CustomerLoyaltyHttpAdapter);

    await expect(adapter.read('customer-token')).resolves.toEqual(projection);

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:8790/api/self-checkout/customer/loyalty',
      {
        method: 'GET',
        headers: { Authorization: 'Bearer customer-token' },
        cache: 'no-store',
      }
    );
  });

  it('rejects malformed successful responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(response({ ...projection, pointsBalance: -1 }))
    );
    const adapter = TestBed.inject(CustomerLoyaltyHttpAdapter);

    await expect(adapter.read('customer-token')).rejects.toThrow(
      'Customer loyalty is unavailable.'
    );
  });

  it('rejects an unavailable endpoint without exposing its response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ error: 'unavailable' }, 503)));
    const adapter = TestBed.inject(CustomerLoyaltyHttpAdapter);

    await expect(adapter.read('customer-token')).rejects.toThrow(
      'Customer loyalty is unavailable.'
    );
  });
});
