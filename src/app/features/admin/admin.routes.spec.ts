import { describe, it, expect } from 'vitest';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { ADMIN_ROUTES } from './admin.routes';

/**
 * Structural tests for the admin feature route table. The root `app.routes.ts`
 * delegates to this via `loadChildren`, so the guard stacking and lazy loading
 * asserted here are what actually protect the admin area.
 */
describe('ADMIN_ROUTES', () => {
  const usersRoute = ADMIN_ROUTES.find((r) => r.path === 'users');

  it('exposes the users route', () => {
    expect(usersRoute).toBeDefined();
    expect(usersRoute?.title).toBe('Users & Roles · Capy-POS');
  });

  it('gates the users route with authGuard then a permission guard', () => {
    const guards = usersRoute?.canActivate ?? [];
    expect(guards).toHaveLength(2);
    // authGuard runs first (authentication), then the RBAC permission guard.
    expect(guards[0]).toBe(authGuard);
    expect(typeof guards[1]).toBe('function');
  });

  it('lazily loads the OperatorListComponent', async () => {
    expect(usersRoute?.loadComponent).toBeInstanceOf(Function);
    const loaded = await usersRoute?.loadComponent?.();
    expect(loaded).toBeDefined();
    expect((loaded as { name?: string })?.name).toBe('OperatorListComponent');
  });
});
