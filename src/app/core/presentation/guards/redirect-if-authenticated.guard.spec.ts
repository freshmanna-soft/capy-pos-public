import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { InjectionToken } from '@angular/core';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { redirectIfAuthenticatedGuard, type SessionCheck } from './redirect-if-authenticated.guard';
import { CurrentUserService } from '@core/application/auth/current-user.service';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A Router stub whose createUrlTree echoes the target path for assertions. */
function makeRouter() {
  return {
    createUrlTree: vi.fn(
      (commands: string[]) => ({ __url: commands.join('/') }) as unknown as UrlTree
    ),
  };
}

/** A throwaway InjectionToken — proves the guard works for any SessionCheck, not just a hard-coded class. */
const SESSION = new InjectionToken<SessionCheck>('SESSION');

function runGuard(redirectTo = '/pos') {
  const guard = redirectIfAuthenticatedGuard(SESSION, redirectTo);
  return TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
  );
}

function configure(authenticated: boolean) {
  const router = makeRouter();
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: router },
      { provide: SESSION, useValue: { isAuthenticated: () => authenticated } },
    ],
  });
  return router;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('redirectIfAuthenticatedGuard', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('lets a signed-out visitor through to the guest screen', () => {
    configure(false);
    expect(runGuard()).toBe(true);
  });

  it('redirects an already signed-in principal away, to the given target', () => {
    const router = configure(true);
    const result = runGuard('/self-checkout');

    expect(result).not.toBe(true);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/self-checkout']);
  });

  it('never calls createUrlTree for a signed-out visitor', () => {
    const router = configure(false);
    runGuard();
    expect(router.createUrlTree).not.toHaveBeenCalled();
  });

  it('works against a real class token, not just an InjectionToken — proving genericity, not just the test double', () => {
    const router = makeRouter();
    TestBed.configureTestingModule({
      providers: [
        { provide: Router, useValue: router },
        { provide: CurrentUserService, useValue: { isAuthenticated: () => true } },
      ],
    });

    const guard = redirectIfAuthenticatedGuard(CurrentUserService, '/pos');
    const result = TestBed.runInInjectionContext(() =>
      guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
    );

    expect(result).not.toBe(true);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/pos']);
  });
});
