import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ActivatedRouteSnapshot, Router, RouterStateSnapshot, UrlTree } from '@angular/router';
import { permissionGuard } from './permission.guard';
import { AngularAuthorizationService } from '@core/application/auth/angular-authorization.service';
import { CurrentUserService } from '@core/application/auth/current-user.service';
import { Permission } from '@core/domain/auth/permission.constants';

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

function runGuard() {
  const guard = permissionGuard(Permission.MANAGE_OPERATORS);
  return TestBed.runInInjectionContext(() =>
    guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
  );
}

function configure(opts: { authenticated: boolean; can: boolean }) {
  const router = makeRouter();
  TestBed.configureTestingModule({
    providers: [
      { provide: Router, useValue: router },
      { provide: CurrentUserService, useValue: { isAuthenticated: () => opts.authenticated } },
      { provide: AngularAuthorizationService, useValue: { can: () => opts.can } },
    ],
  });
  return router;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('permissionGuard', () => {
  beforeEach(() => TestBed.resetTestingModule());

  it('allows navigation when the user holds the permission', () => {
    configure({ authenticated: true, can: true });
    expect(runGuard()).toBe(true);
  });

  it('redirects an authenticated-but-unauthorised user to /pos (not /login)', () => {
    const router = configure({ authenticated: true, can: false });
    const result = runGuard();

    expect(result).not.toBe(true);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/pos']);
  });

  it('redirects an unauthenticated user to /login', () => {
    const router = configure({ authenticated: false, can: false });
    const result = runGuard();

    expect(result).not.toBe(true);
    expect(router.createUrlTree).toHaveBeenCalledWith(['/login']);
  });
});
