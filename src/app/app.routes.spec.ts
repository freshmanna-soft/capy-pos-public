import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Component, createEnvironmentInjector, EnvironmentInjector } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router, type Route } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { appConfig } from './app.config';
import { routes } from './app.routes';

/** Stands in for the real shop, which is not what the redirect tests are about. */
@Component({ template: 'shop' })
class ShopStubComponent {}

/**
 * Structural tests for the root route table.
 *
 * The properties pinned here are route-level, so a component spec cannot see
 * them: which lanes a customer can reach without a staff session, that the
 * retired `/self-checkout` URLs still land somewhere useful, and that a customer
 * identity stays unresolvable app-wide now that no route binds one.
 */
describe('routes', () => {
  it('leaves /clerk unguarded so an anonymous customer can reach the capybara', () => {
    // #219: the clerk lane was gated by the STAFF session purely because it was
    // built for the till first. Nothing behind it needs an operator, and a
    // customer holding a basket has no login — so re-adding the guard here would
    // put the customer journey back behind a screen they cannot pass.
    const clerk = routes.find((r) => r.path === 'clerk');
    expect(clerk).toBeDefined();
    expect(clerk?.canActivate ?? []).not.toContain(authGuard);
    expect(clerk?.canActivate).toBeUndefined();
  });

  /**
   * The retired customer lane. Run through a real router rather than asserted
   * structurally, because what matters is where the URL actually ends up — the
   * difference between a prefix and a full match, or a relative and an absolute
   * redirect, is invisible in the route object and decides whether
   * `/self-checkout/sign-in` reaches the shop or `/shop/sign-in`.
   *
   * Only the redirect entry comes from the real table; `/shop` is a stub so the
   * test does not boot the whole shop (geofence, camera, catalogue) to prove a
   * URL.
   */
  describe('the retired /self-checkout lane', () => {
    beforeEach(() => {
      const redirect = routes.find((r) => r.path === 'self-checkout');
      expect(redirect, 'the old lane must keep an explicit redirect').toBeDefined();
      TestBed.configureTestingModule({
        providers: [
          provideRouter([redirect as Route, { path: 'shop', component: ShopStubComponent }]),
        ],
      });
    });

    it.each([
      '/self-checkout',
      '/self-checkout/sign-in',
      '/self-checkout/sign-up',
      '/self-checkout/check-email',
      '/self-checkout/pay',
    ])('sends %s to /shop', async (url) => {
      const harness = await RouterTestingHarness.create();
      await harness.navigateByUrl(url);

      expect(TestBed.inject(Router).url).toBe('/shop');
    });

    it('is declared before the wildcard, so it is the route that answers', () => {
      const paths = routes.map((r) => r.path);
      expect(paths.indexOf('self-checkout')).toBeLessThan(paths.indexOf('**'));
    });
  });

  /**
   * The customer identity domain (`CurrentCustomerService`, the App ID customer
   * adapter) is kept for a future customer lane, but nothing binds it today.
   * It must stay that way until a route opts in: a customer identity resolvable
   * from the root injector could be consulted for authorization anywhere.
   *
   * The root injector is built from `appConfig.providers` — the application's
   * real composition root — and not from `TestBed.inject(EnvironmentInjector)`,
   * whose bare injector would report the token absent whether or not someone
   * bound it in `auth.providers.ts`.
   */
  describe('customer identity scoping', () => {
    let appRoot: EnvironmentInjector;

    beforeEach(() => {
      appRoot = createEnvironmentInjector(appConfig.providers, TestBed.inject(EnvironmentInjector));
    });

    afterEach(() => {
      appRoot.destroy();
    });

    it('is NOT resolvable from the application root injector', () => {
      expect(appRoot.get(CUSTOMER_AUTH_GATEWAY, null)).toBeNull();
      expect(() => appRoot.get(CUSTOMER_AUTH_GATEWAY)).toThrow();
      expect(appRoot.get(CurrentCustomerService, null)).toBeNull();
    });

    it('is bound on no route', () => {
      expect(routesProviding(CUSTOMER_AUTH_GATEWAY)).toEqual([]);
      expect(routesProviding(CurrentCustomerService)).toEqual([]);
    });
  });

  it('still guards the staff-only routes, for contrast', () => {
    for (const path of ['pos', 'inventory', 'reports', 'dashboard']) {
      const route = routes.find((r) => r.path === path);
      expect(route?.canActivate, `/${path} should stay staff-guarded`).toContain(authGuard);
    }
  });
});

/**
 * Every route path (children included) whose `providers` bind `token`.
 *
 * Recursive on both axes, and both matter. Angular flattens provider arrays, so
 * `providers: [CUSTOMER_AUTH_PROVIDERS]` — an array included without spreading
 * it — is a legal binding a one-level scan would wave through; and a scan of
 * top-level routes alone could not see a binding on a child.
 */
function routesProviding(token: unknown): string[] {
  const binds = (provider: unknown): boolean =>
    Array.isArray(provider)
      ? provider.some(binds)
      : provider === token ||
        (typeof provider === 'object' &&
          provider !== null &&
          (provider as { provide?: unknown }).provide === token);

  const found: string[] = [];
  const walk = (table: readonly Route[], prefix: string): void => {
    for (const route of table) {
      const path = [prefix, route.path].filter(Boolean).join('/');
      if (binds(route.providers ?? [])) found.push(path);
      if (route.children) walk(route.children, path);
    }
  };
  walk(routes, '');
  return found;
}
