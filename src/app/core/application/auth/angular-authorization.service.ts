import { Injectable, inject } from '@angular/core';
import { AuthorizationService, AuthorizationError } from '@core/domain/auth/authorization.service';
import { Permission } from '@core/domain/auth/permission.constants';
import { RoleName } from '@core/domain/auth/role.value-object';
import { CurrentUserService } from './current-user.service';

export { AuthorizationError };

/**
 * AngularAuthorizationService (Application layer)
 *
 * Angular-injectable wrapper around the pure-domain AuthorizationService.
 * Reads the current principal's roles from CurrentUserService (signals)
 * and delegates evaluation to the framework-free domain service.
 *
 * Components and use-cases use THIS service; the domain service stays
 * framework-free and unit-testable without Angular.
 */
@Injectable({ providedIn: 'root' })
export class AngularAuthorizationService {
  private readonly currentUser = inject(CurrentUserService);
  private readonly authz = new AuthorizationService();

  /**
   * Returns true when the current user has the given permission.
   * Returns false when not authenticated.
   */
  can(permission: Permission): boolean {
    const roles = this.currentUser.roles();
    return this.authz.can(roles, permission);
  }

  /**
   * Returns true when the current user's highest role is at least
   * as privileged as the given minimum.
   */
  atLeast(minRole: RoleName): boolean {
    const roles = this.currentUser.roles();
    return this.authz.atLeast(roles, minRole);
  }

  /**
   * Throws AuthorizationError when the current user lacks the permission.
   * Use this at the use-case/service layer to enforce boundaries.
   */
  assert(permission: Permission): void {
    const roles = this.currentUser.roles();
    this.authz.assert(roles, permission);
  }
}
