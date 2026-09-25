import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi } from 'vitest';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { customerSessionHydrationGuard } from './customer-session-hydration.guard';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';

function makeCustomerGateway(opts: { hydrateFails?: boolean } = {}) {
  return {
    getActiveSession: opts.hydrateFails
      ? vi.fn().mockRejectedValue(new Error('storage unavailable'))
      : vi.fn().mockResolvedValue(null),
    signIn: vi.fn(),
    signUp: vi.fn(),
    signOut: vi.fn().mockResolvedValue(undefined),
    refresh: vi.fn(),
  };
}

async function runGuard() {
  return TestBed.runInInjectionContext(() =>
    customerSessionHydrationGuard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
  );
}

describe('customerSessionHydrationGuard', () => {
  it('always returns true when hydration succeeds', async () => {
    TestBed.configureTestingModule({
      providers: [
        CurrentCustomerService,
        { provide: CUSTOMER_AUTH_GATEWAY, useValue: makeCustomerGateway() },
      ],
    });

    const result = await runGuard();
    expect(result).toBe(true);
  });

  it('returns true even when hydration throws (continuing anonymously)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    TestBed.configureTestingModule({
      providers: [
        CurrentCustomerService,
        { provide: CUSTOMER_AUTH_GATEWAY, useValue: makeCustomerGateway({ hydrateFails: true }) },
      ],
    });

    const result = await runGuard();

    expect(result).toBe(true);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('Customer session hydration failed'),
      expect.any(Error)
    );

    warnSpy.mockRestore();
  });
});
