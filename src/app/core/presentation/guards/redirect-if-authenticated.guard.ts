import { inject, type ProviderToken } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';

/**
 * The minimal shape any session service needs for this guard — deliberately
 * just the one method `authGuard`/`permissionGuard` already call on
 * {@link CurrentUserService}, structurally typed rather than tied to that
 * concrete class. That's what makes this guard reusable for a second,
 * independent identity (the customer session, Phase 4) without knowing
 * anything about it beyond "can answer whether it's signed in."
 */
export interface SessionCheck {
  isAuthenticated(): boolean;
}

/**
 * redirectIfAuthenticatedGuard (functional CanActivateFn factory)
 *
 * The guard nothing in this app has had until now: keeps an *already*
 * signed-in principal off a sign-in/sign-up screen, redirecting them
 * somewhere useful instead. `authGuard`/`permissionGuard` only ever guard
 * the opposite direction (require a session); a guest-only screen had no
 * equivalent to reach for.
 *
 * Takes the session token to check rather than hard-coding
 * {@link CurrentUserService}, the way `permissionGuard` hard-codes it — this
 * one needs to work for the *customer* session (Phase 4's own
 * `CurrentCustomerService`, not built yet) without changing, so genericity
 * is the point, not an abstraction for its own sake. `inject(token)` happens
 * inside the returned function, not at this factory call site, because a
 * route's `canActivate` array is built at module-load time, before any
 * injector exists — only the guard function itself runs inside one.
 *
 * Usage (once a customer session service exists):
 *   canActivate: [redirectIfAuthenticatedGuard(CurrentCustomerService, '/self-checkout')]
 */
export function redirectIfAuthenticatedGuard(
  token: ProviderToken<SessionCheck>,
  redirectTo: string
): CanActivateFn {
  return () => {
    const session = inject(token);

    if (session.isAuthenticated()) {
      return inject(Router).createUrlTree([redirectTo]);
    }

    return true;
  };
}
