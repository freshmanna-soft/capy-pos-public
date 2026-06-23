import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { CurrentUserService } from '@core/application/auth/current-user.service';

/**
 * authGuard (functional CanActivateFn)
 *
 * Blocks navigation to protected routes when the operator is not authenticated.
 * Redirects to /login while preserving the attempted URL as a query param so
 * the login page can redirect back after a successful sign-in.
 *
 * Usage in routes:
 *   canActivate: [authGuard]
 */
export const authGuard: CanActivateFn = (route, state) => {
  const currentUser = inject(CurrentUserService);
  const router = inject(Router);

  if (currentUser.isAuthenticated()) {
    return true;
  }

  // Redirect to /login and preserve the attempted URL
  return router.createUrlTree(['/login'], {
    queryParams: { returnUrl: state.url },
  });
};
