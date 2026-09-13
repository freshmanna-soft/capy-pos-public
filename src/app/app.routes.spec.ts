import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ActivatedRouteSnapshot,
  Router,
  RouterStateSnapshot,
  UrlTree,
  type CanActivateFn,
  type Route,
} from '@angular/router';
import {
  createEnvironmentInjector,
  EnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { authGuard } from '@core/presentation/guards/auth.guard';
import { CUSTOMER_AUTH_GATEWAY } from '@core/application/auth/ports/customer-auth-gateway.port';
import { CurrentCustomerService } from '@core/application/auth/current-customer.service';
import { AppIdCustomerAuthAdapter } from '@core/infrastructure/auth/appid-customer-auth.adapter';
import { SELF_CHECKOUT_TITLE } from '@features/self-checkout/self-checkout-palette';
import {
  CHECK_EMAIL_ROUTE,
  LANE_ROUTE,
  SIGN_UP_ROUTE,
} from '@features/self-checkout/self-checkout-routes';
import { PendingRegistrationStore } from '@features/self-checkout/pending-registration.store';
import { Permission } from '@core/domain/auth';
import { appConfig } from './app.config';
import { routes } from './app.routes';

/**
 * Structural tests for the root route table.
 *
 * The self-checkout family is asserted here rather than only in the component
 * specs because its defining properties are all route-level: it is a top-level
 * route (not a child of /pos, whose chrome and staff guard it would inherit), it
 * carries no `authGuard` — the staff session is the wrong gate for a customer
 * lane — and, since items 16/17 added the sign-up form and the interstitial, the
 * lane and its two side paths share ONE injector. Each is the kind of thing a
 * well-meaning edit ("add the guard back", "give the form its own providers")
 * would silently break.
 */
describe('routes', () => {
  const selfCheckout = routes.find((r) => r.path === 'self-checkout');
  const children = selfCheckout?.children ?? [];
  const lane = children.find((c) => c.path === '');
  const signUp = children.find((c) => c.path === 'sign-up');
  const checkEmail = children.find((c) => c.path === 'check-email');

  it('registers /self-checkout as a top-level route whose lane is its empty child', () => {
    expect(selfCheckout).toBeDefined();
    // Inline `children`, never `loadChildren`: the guard on the sign-up child and
    // the providers on this parent have to be in the same eagerly-evaluated
    // table (see the route's own comment for the bundle measurements).
    expect(selfCheckout?.loadChildren).toBeUndefined();
    expect(lane).toBeDefined();
    // `pathMatch: 'full'`, so /self-checkout/sign-up cannot resolve to the lane
    // by accident of child ordering.
    expect(lane?.pathMatch).toBe('full');
    expect(lane?.title).toBe(SELF_CHECKOUT_TITLE);
  });

  it('exposes the sign-up form and the check-email interstitial under that parent', () => {
    // The paths the shared constants promise (`self-checkout-routes.ts`), which
    // is what the components navigate with — assert the table actually answers
    // them rather than trusting two copies of the same string.
    expect(`/self-checkout/${signUp?.path}`).toBe(SIGN_UP_ROUTE);
    expect(`/self-checkout/${checkEmail?.path}`).toBe(CHECK_EMAIL_ROUTE);
    expect(`/${selfCheckout?.path}`).toBe(LANE_ROUTE);
  });

  it('leaves /self-checkout and every child unguarded by the staff authGuard', () => {
    expect(selfCheckout?.canActivate).toBeUndefined();
    for (const child of children) {
      expect(child.canActivate ?? [], `/${child.path} should not be staff-guarded`).not.toContain(
        authGuard
      );
    }
  });

  /**
   * The guarding inside the family is asymmetric on purpose, and the asymmetry is
   * the part worth pinning — both directions of "make it consistent" break
   * something a product decision asked for:
   *
   * - guarding the **lane** would make an account required to scan or pay, which
   *   the 2026-09-11 options 1+3 decision exists to forbid, and the lane is also
   *   this guard's own redirect target, so it would bounce off itself;
   * - guarding **check-email** would bounce a customer off the one screen that
   *   explains why they cannot sign in yet. Item 3 proved a just-created account
   *   is `PENDING`, so nobody arriving there is signed in anyway — but a customer
   *   who registers a second address while already signed in would be sent away
   *   from the interstitial naming the inbox they need to open;
   * - **sign-up** is the only screen a signed-in customer has no use for, so it is
   *   the only one that redirects.
   */
  it('guards only the sign-up child, and deliberately neither the lane nor check-email', () => {
    expect(signUp?.canActivate).toHaveLength(1);
    expect(
      checkEmail?.canActivate,
      'check-email must stay reachable when signed in'
    ).toBeUndefined();
    expect(lane?.canActivate, 'the lane must never require an account').toBeUndefined();
    expect(children.filter((c) => c.canActivate !== undefined).map((c) => c.path)).toEqual([
      'sign-up',
    ]);
  });

  it('lazily loads the SelfCheckoutComponent', async () => {
    expect(lane?.loadComponent).toBeInstanceOf(Function);
    const loaded = await lane?.loadComponent?.();
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
  describe('customer identity scoping', () => {
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
      expect(appRoot.get(CurrentCustomerService, null)).toBeNull();
    });

    it('binds the gateway on the self-checkout route and on no other route', () => {
      expect(routesProviding(CUSTOMER_AUTH_GATEWAY)).toEqual(['self-checkout']);
    });

    it('provides CurrentCustomerService exactly once, on the parent the whole family shares', () => {
      // The regression this pins: as three sibling routes each carrying their own
      // `CurrentCustomerService`, the form wrote a session into one instance, the
      // next screen read a second, and the guard resolved a third that was
      // permanently signed out. Angular gives a route subtree one environment
      // injector, so "provided once, on the parent" is the whole fix — and the
      // only shape in which the guard, the form and the lane can agree on who is
      // signed in. A second copy anywhere below re-creates the bug in silence.
      expect(routesProviding(CurrentCustomerService)).toEqual(['self-checkout']);
      for (const child of children) {
        expect(
          child.providers,
          `/${child.path} must inherit the customer identity, not re-provide it`
        ).toBeUndefined();
      }
    });

    it('provides PendingRegistrationStore once too, on the same shared parent', () => {
      // Same failure mode as the service above, one screen further along: the
      // sign-up form remembers the registered address here and the interstitial
      // takes it, so a per-child copy would mean the form writing to an instance
      // the next screen cannot see — which is what sent the address through
      // `queryParams` and into the URL of a shared terminal in the first place.
      expect(routesProviding(PendingRegistrationStore)).toEqual(['self-checkout']);
      expect(appRoot.get(PendingRegistrationStore, null)).toBeNull();
      expect(selfCheckoutRoute.get(PendingRegistrationStore)).toBeInstanceOf(
        PendingRegistrationStore
      );
    });

    /**
     * `redirectIfAuthenticatedGuard`, run for real out of the route table.
     *
     * Deliberately not `redirectIfAuthenticatedGuard(CurrentCustomerService, …)`
     * called afresh: that tests the factory (which
     * `redirect-if-authenticated.guard.spec.ts` already does) and would pass
     * whether or not the route wires it at all. This reaches into the sign-up
     * child's own `canActivate[0]` and runs it inside an injector built from the
     * *parent's* providers, so what it proves is the thing that was broken — the
     * guard sees the very `CurrentCustomerService` the rest of the family writes
     * to. Delete the `canActivate` line and these two fail.
     */
    describe('the sign-up route guard', () => {
      const createUrlTree = vi.fn(
        (commands: string[]) => ({ __url: commands.join('/') }) as unknown as UrlTree
      );

      function guardInjector(): EnvironmentInjector {
        return createEnvironmentInjector(
          [...(selfCheckout?.providers ?? []), { provide: Router, useValue: { createUrlTree } }],
          appRoot
        );
      }

      function runGuard(injector: EnvironmentInjector) {
        const guard = signUp?.canActivate?.[0] as CanActivateFn;
        expect(guard, 'the sign-up child must carry a canActivate guard').toBeInstanceOf(Function);
        return runInInjectionContext(injector, () =>
          guard({} as ActivatedRouteSnapshot, {} as RouterStateSnapshot)
        );
      }

      beforeEach(() => {
        // Braced on purpose: `mockClear()` returns the mock, and an arrow that
        // returns a *function* is taken by vitest as this hook's teardown — it
        // would then call the guard's own Router stub with no arguments.
        createUrlTree.mockClear();
      });

      it('lets a signed-out customer reach the form', () => {
        const injector = guardInjector();
        try {
          expect(runGuard(injector)).toBe(true);
          expect(createUrlTree).not.toHaveBeenCalled();
        } finally {
          injector.destroy();
        }
      });

      it('redirects a customer who is already signed in back to the lane', () => {
        vi.useFakeTimers();
        const injector = guardInjector();
        try {
          // The session is published through the SAME instance the guard will
          // resolve, because both come from this one injector — which only holds
          // because the providers above are the parent's.
          injector.get(CurrentCustomerService).setSession({
            customerId: 'customer-abc',
            email: 'shopper@capy.test',
            tenantId: 'store-a',
            roles: ['customer'],
            permissions: [Permission.PROCESS_SALE],
            accessToken: 'token',
            expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
          });

          expect(runGuard(injector)).not.toBe(true);
          expect(createUrlTree).toHaveBeenCalledWith([LANE_ROUTE]);
        } finally {
          injector.destroy();
          vi.useRealTimers();
        }
      });
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
 * it — is a legal binding a one-level scan would wave through; and the family is
 * now a parent with children, so a scan of top-level routes alone could not see
 * a second copy re-appearing on a child.
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
