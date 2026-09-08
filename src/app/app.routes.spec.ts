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

  it('keeps the staff clerk lane guarded, for contrast', () => {
    const clerk = routes.find((r) => r.path === 'clerk');
    expect(clerk?.canActivate).toContain(authGuard);
  });
});
