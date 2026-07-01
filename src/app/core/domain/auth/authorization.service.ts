import { Role, RoleName } from './role.value-object';
import { Permission } from './permission.constants';

/**
 * AuthorizationService (Domain)
 *
 * Pure, framework-free evaluation service.
 * Answers "can this principal perform this action?" using the Role hierarchy
 * and permission sets already defined on the Role value object.
 *
 * Callers pass the principal's role-name strings and the required permission.
 * The service resolves Role objects and delegates to Role.hasPermission().
 *
 * Hierarchy: Operator (level 1) < Manager (level 2) < Admin (level 3).
 * A role satisfies a permission when any of the actor's roles includes it
 * (roles are additive — Manager includes all Operator permissions, etc.)
 */
export class AuthorizationService {
  /**
   * Returns true when at least one of the supplied roles has the given permission.
   * Roles carry their own permission set (built-in or data-driven), so evaluation
   * never re-derives permissions from a role name.
   *
   * @param roles - the principal's resolved roles for the active tenant
   * @param permission - the permission constant to check
   */
  can(roles: readonly Role[], permission: Permission): boolean {
    if (roles.length === 0) return false;
    return roles.some((role) => role.hasPermission(permission));
  }

  /**
   * Returns true when at least one of the supplied roles is at least as
   * privileged (by level) as the required minimum role.
   *
   * @param roles   - the principal's resolved roles
   * @param minRole - the minimum built-in RoleName required
   */
  atLeast(roles: readonly Role[], minRole: RoleName): boolean {
    if (roles.length === 0) return false;
    const threshold = new Role(minRole);
    return roles.some((role) => role.atLeast(threshold));
  }

  /**
   * Asserts the principal has the given permission.
   * Throws `AuthorizationError` when denied.
   */
  assert(roles: readonly Role[], permission: Permission): void {
    if (!this.can(roles, permission)) {
      throw new AuthorizationError(permission);
    }
  }
}

/**
 * Thrown by AuthorizationService.assert() when a permission check fails.
 * Extends Error so it can be caught generically at the application layer.
 */
export class AuthorizationError extends Error {
  readonly code = 'AUTHORIZATION_DENIED';

  constructor(public readonly permission: Permission) {
    super(`Permission denied: '${permission}'`);
    this.name = 'AuthorizationError';
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
}
