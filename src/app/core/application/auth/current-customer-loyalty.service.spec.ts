import { TestBed } from '@angular/core/testing';
import { describe, expect, it, vi } from 'vitest';
import { CurrentCustomerService } from './current-customer.service';
import { CurrentCustomerLoyaltyService } from './current-customer-loyalty.service';
import { CUSTOMER_AUTH_GATEWAY } from './ports/customer-auth-gateway.port';
import { CUSTOMER_LOYALTY_GATEWAY } from '@core/application/ports/customer-loyalty-gateway.port';
import { CustomerSessionDto } from './dtos/customer-session.dto';

const expiresAt = new Date(Date.now() + 3_600_000).toISOString();

function session(customerId: string, accessToken = `token-${customerId}`): CustomerSessionDto {
  return {
    customerId,
    email: `${customerId}@example.com`,
    tenantId: 'default-tenant',
    roles: ['customer'],
    permissions: [],
    accessToken,
    expiresAt,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const projection = {
  status: 'available' as const,
  pointsBalance: 1250,
  tier: 'silver' as const,
  policyVersion: 'self-checkout-usd-v1' as const,
  updatedAt: '2027-01-15T10:00:00.000Z',
};

describe('CurrentCustomerLoyaltyService', () => {
  function setup(read = vi.fn()) {
    TestBed.configureTestingModule({
      providers: [
        CurrentCustomerService,
        CurrentCustomerLoyaltyService,
        {
          provide: CUSTOMER_AUTH_GATEWAY,
          useValue: { signOut: vi.fn().mockResolvedValue(undefined) },
        },
        { provide: CUSTOMER_LOYALTY_GATEWAY, useValue: { read } },
      ],
    });
    const customer = TestBed.inject(CurrentCustomerService);
    const loyalty = TestBed.inject(CurrentCustomerLoyaltyService);
    TestBed.tick();
    return { customer, loyalty, read };
  }

  it('stays empty for guests and does not call the server', () => {
    const { loyalty, read } = setup();

    expect(loyalty.projection()).toBeNull();
    expect(loyalty.unavailable()).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('loads the server projection using the current customer bearer', async () => {
    const read = vi.fn().mockResolvedValue(projection);
    const { customer, loyalty } = setup(read);

    customer.setSession(session('customer-a'));
    TestBed.tick();
    await vi.waitFor(() => expect(loyalty.projection()).toEqual(projection));

    expect(read).toHaveBeenCalledWith('token-customer-a');
    expect(loyalty.pointsBalance()).toBe(1250);
    expect(loyalty.tier()).toBe('silver');
  });

  it('discards customer A response after switching to customer B', async () => {
    const customerA = deferred<typeof projection>();
    const customerB = deferred<typeof projection>();
    const read = vi
      .fn()
      .mockReturnValueOnce(customerA.promise)
      .mockReturnValueOnce(customerB.promise);
    const { customer, loyalty } = setup(read);

    customer.setSession(session('customer-a'));
    TestBed.tick();
    customer.setSession(session('customer-b'));
    TestBed.tick();

    customerA.resolve(projection);
    await Promise.resolve();
    expect(loyalty.projection()).toBeNull();

    const bProjection = { ...projection, pointsBalance: 40, tier: 'bronze' as const };
    customerB.resolve(bProjection);
    await vi.waitFor(() => expect(loyalty.projection()).toEqual(bProjection));
  });

  it('clears immediately on logout and ignores the in-flight response', async () => {
    const pending = deferred<typeof projection>();
    const { customer, loyalty } = setup(vi.fn().mockReturnValue(pending.promise));

    customer.setSession(session('customer-a'));
    TestBed.tick();
    await customer.logout();
    TestBed.tick();

    expect(loyalty.projection()).toBeNull();
    pending.resolve(projection);
    await Promise.resolve();
    expect(loyalty.projection()).toBeNull();
  });

  it('reports loyalty unavailable without changing the customer session', async () => {
    const { customer, loyalty } = setup(vi.fn().mockRejectedValue(new Error('offline')));

    customer.setSession(session('customer-a'));
    TestBed.tick();
    await vi.waitFor(() => expect(loyalty.unavailable()).toBe(true));

    expect(customer.isAuthenticated()).toBe(true);
    expect(loyalty.projection()).toBeNull();
  });

  it('refresh() reloads the projection when a session is active', async () => {
    const read = vi.fn().mockResolvedValue(projection);
    const { customer, loyalty } = setup(read);

    customer.setSession(session('customer-a'));
    TestBed.tick();
    await vi.waitFor(() => expect(loyalty.projection()).toEqual(projection));

    // Change the server value and trigger a refresh
    const updated = { ...projection, pointsBalance: 999 };
    read.mockResolvedValue(updated);
    loyalty.refresh();
    await vi.waitFor(() => expect(loyalty.projection()).toEqual(updated));
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('refresh() when session is null does nothing', () => {
    const read = vi.fn();
    const { loyalty } = setup(read);
    // No session set — session() is null
    loyalty.refresh();
    // refresh() early-returns without calling load when session is null
    expect(read).not.toHaveBeenCalled();
  });
});
