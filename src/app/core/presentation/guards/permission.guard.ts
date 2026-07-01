import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { Permission } from '@core/domain/auth/permission.constants';
import { AngularAuthorizationService } from '@core/application/auth/angular-authorization.service';
import { CurrentUserService } from '@core/application/auth/current-user.service';

/**
 * permissionGuard (functional CanActivateFn factory)
 *
 * Route-level RBAC gate. Stacks *after* {@link authGuard}:
 *
 *   canActivate: [authGuard, permissionGuard(Permission.MANAGE_OPERATORS)]
 *
 * Redirect targets are deliberately different from authGuard:
 *   - Not authenticated  → /login (defence in depth; authGuard normally handles this)
 *   - Authenticated but lacking the permission → /pos (they have a home to go to;
 *     bouncing them to /login would be wrong — they are already signed in).
 *
 * This is the authoritative route gate. The `*appHasPermission` directive only
 * hides UI, and use-cases assert at the application layer; this guard stops the
 * lazy chunk from loading at all for an unauthorised principal.
 */
export function permissionGuard(permission: Permission): CanActivateFn {
  return (): boolean | UrlTree => {
    const authz = inject(AngularAuthorizationService);
    const currentUser = inject(CurrentUserService);
    const router = inject(Router);

    if (!currentUser.isAuthenticated()) {
      return router.createUrlTree(['/login']);
    }

    if (authz.can(permission)) {
      return true;
    }

    // Authenticated but not permitted — send them back to a page they can use.
    return router.createUrlTree(['/pos']);
  };
}
