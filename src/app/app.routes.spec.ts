import { describe, it, expect } from 'vitest';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { SELF_CHECKOUT_TITLE } from '@features/self-checkout/self-checkout-palette';
import { routes } from './app.routes';

/**
 * Structural tests for the root route table.
 *
 * The self-checkout lane is asserted here rather than only in the component spec
 * because its two defining properties are route-level: it is a top-level route
 * (not a child of /pos, whose chrome and staff guard it would inherit), and it
 * carries no `authGuard` — the staff session is the wrong gate for a customer
 * lane. Both are the kind of thing a well-meaning "add the guard back" edit
 * would silently break.
 */
describe('routes', () => {
  const selfCheckout = routes.find((r) => r.path === 'self-checkout');

  it('registers /self-checkout as a top-level route', () => {
    expect(selfCheckout).toBeDefined();
    expect(selfCheckout?.children).toBeUndefined();
    expect(selfCheckout?.loadChildren).toBeUndefined();
    expect(selfCheckout?.title).toBe(SELF_CHECKOUT_TITLE);
  });

  it('leaves /self-checkout unguarded by the staff authGuard', () => {
    expect(selfCheckout?.canActivate ?? []).not.toContain(authGuard);
    expect(selfCheckout?.canActivate).toBeUndefined();
  });

  it('lazily loads the SelfCheckoutComponent', async () => {
    expect(selfCheckout?.loadComponent).toBeInstanceOf(Function);
    const loaded = await selfCheckout?.loadComponent?.();
    expect((loaded as { name?: string })?.name).toBe('SelfCheckoutComponent');
  });

  it('leaves /clerk unguarded so an anonymous customer can reach the capybara', () => {
    // #219: the clerk lane was gated by the STAFF session purely because it was
    // built for the till first. Nothing behind it needs an operator, and a
    // customer holding a basket has no login — so re-adding the guard here would
    // put the whole self-checkout journey back behind a screen they cannot pass.
    const clerk = routes.find((r) => r.path === 'clerk');
    expect(clerk).toBeDefined();
    expect(clerk?.canActivate ?? []).not.toContain(authGuard);
    expect(clerk?.canActivate).toBeUndefined();
  });

  it('still guards the staff-only routes, for contrast', () => {
    for (const path of ['pos', 'inventory', 'reports', 'dashboard']) {
      const route = routes.find((r) => r.path === path);
      expect(route?.canActivate, `/${path} should stay staff-guarded`).toContain(authGuard);
    }
  });
});
