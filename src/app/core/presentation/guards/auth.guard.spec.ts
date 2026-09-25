import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { authGuard } from './auth.guard';
import { CurrentUserService } from '@core/application/auth/current-user.service';

function runGuard(url = '/pos') {
  return TestBed.runInInjectionContext(() =>
    authGuard({} as ActivatedRouteSnapshot, { url } as RouterStateSnapshot)
  );
}

describe('authGuard', () => {
  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: Router,
          useValue: {
            createUrlTree: vi.fn(
              (commands: string[], extras?: object) =>
                ({ __url: commands[0], ...extras }) as unknown as UrlTree
            ),
          },
        },
        { provide: CurrentUserService, useValue: { isAuthenticated: () => false } },
      ],
    });
  });

  it('allows navigation when the operator is authenticated', () => {
    TestBed.overrideProvider(CurrentUserService, {
      useValue: { isAuthenticated: () => true },
    });

    expect(runGuard()).toBe(true);
  });

  it('redirects unauthenticated operators to /login with a returnUrl', () => {
    const router = TestBed.inject(Router);

    const result = runGuard('/pos/products');

    expect(result).not.toBe(true);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login'], {
      queryParams: { returnUrl: '/pos/products' },
    });
  });
});
