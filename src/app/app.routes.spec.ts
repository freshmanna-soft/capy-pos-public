import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Route } from '@angular/router';
import { createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { AppIdCustomerAuthAdapter } from '@core/infrastructure/auth/appid-customer-auth.adapter';
import { SELF_CHECKOUT_TITLE } from '@features/self-checkout/self-checkout-palette';
import { appConfig } from './app.config';
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

  /**
   * The CUSTOMER_AUTH_GATEWAY binding (epic #261 item 13). Both halves matter,
   * and the negative one is the actual point of the item.
   *
   * The root injector under test is built from `appConfig.providers` — the
   * application's real composition root — and not from `TestBed.inject(
   * EnvironmentInjector)`. That distinction is the whole test: the bare TestBed
   * injector has none of the app's providers in it, so asserting the token is
   * absent from *it* proves only that the token has no `providedIn` factory. It
   * would stay green if someone "simplified" the binding into `auth.providers.ts`
   * and made a customer identity resolvable app-wide, which is exactly the
   * regression these tests exist to catch.
   *
   * The route injector is then a child of that root, the same construction the
   * router performs for a route that declares `providers`.
   */
  describe('CUSTOMER_AUTH_GATEWAY scoping', () => {
    let appRoot: EnvironmentInjector;
    let selfCheckoutRoute: EnvironmentInjector;

    beforeEach(() => {
      appRoot = createEnvironmentInjector(appConfig.providers, TestBed.inject(EnvironmentInjector));
      selfCheckoutRoute = createEnvironmentInjector(selfCheckout?.providers ?? [], appRoot);
    });

    afterEach(() => {
      selfCheckoutRoute.destroy();
      appRoot.destroy();
    });

    it('resolves to AppIdCustomerAuthAdapter inside the self-checkout route context', () => {
      expect(selfCheckoutRoute.get(CUSTOMER_AUTH_GATEWAY)).toBeInstanceOf(AppIdCustomerAuthAdapter);
    });

    it('is NOT resolvable from the application root injector', () => {
      // `null` sentinel first: a token bound nowhere in `appConfig.providers` and
      // carrying no `providedIn` factory must be absent, not merely angry.
      expect(appRoot.get(CUSTOMER_AUTH_GATEWAY, null)).toBeNull();
      expect(() => appRoot.get(CUSTOMER_AUTH_GATEWAY)).toThrow();
    });

    it('is bound on the self-checkout route and on no other route', () => {
      // Recursive, because Angular flattens provider arrays: `providers:
      // [CUSTOMER_AUTH_PROVIDERS]` — an array included without spreading it — is
      // a legal binding that a one-level scan would wave through.
      const bindsCustomerGateway = (provider: unknown): boolean =>
        Array.isArray(provider)
          ? provider.some(bindsCustomerGateway)
          : typeof provider === 'object' &&
            provider !== null &&
            (provider as { provide?: unknown }).provide === CUSTOMER_AUTH_GATEWAY;

      const routesBindingIt = routes.filter((route: Route) =>
        bindsCustomerGateway(route.providers ?? [])
      );

      expect(routesBindingIt.map((route) => route.path)).toEqual(['self-checkout']);
    });
  });

  it('still guards the staff-only routes, for contrast', () => {
    for (const path of ['pos', 'inventory', 'reports', 'dashboard']) {
      const route = routes.find((r) => r.path === path);
      expect(route?.canActivate, `/${path} should stay staff-guarded`).toContain(authGuard);
    }
  });
});
